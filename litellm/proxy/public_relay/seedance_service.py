from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass

import httpx
from pydantic import TypeAdapter, ValidationError

from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.public_relay.db_types import VideoTaskRow
from litellm.proxy.public_relay.money import UsageQuantity, token_charge_micros
from litellm.proxy.public_relay.repository import (
    create_video_task,
    get_active_price,
    get_video_task,
    get_video_task_by_idempotency,
    record_video_poll_failure,
    release_request,
    reserve_request,
    settle_request,
    update_video_task,
)
from litellm.proxy.public_relay.request_billing import is_public_relay_key
from litellm.proxy.public_relay.seedance_client import (
    SeedanceClient,
    SeedanceFailure,
    parse_create_response,
    parse_status_response,
)
from litellm.proxy.public_relay.seedance_types import (
    SeedanceSettings,
    SeedanceTaskCreateRequest,
    SeedanceTaskCreateResponse,
    estimate_seedance_tokens,
)
from litellm.proxy.utils import PrismaClient

SUCCESS_STATUSES = frozenset({"succeeded", "success", "completed", "done"})
FAILURE_STATUSES = frozenset({"failed", "cancelled", "canceled", "expired", "error"})


@dataclass(frozen=True, slots=True)
class SeedanceRelayError(Exception):
    status_code: int
    message: str
    error_type: str = "invalid_request_error"


@dataclass(frozen=True, slots=True)
class CreatedSeedanceTask:
    task: VideoTaskRow
    response: SeedanceTaskCreateResponse


async def create_seedance_task(
    prisma_client: PrismaClient,
    user: UserAPIKeyAuth,
    payload: SeedanceTaskCreateRequest,
    idempotency_key: str,
    http_client: httpx.AsyncClient,
) -> CreatedSeedanceTask:
    account_id, key_id = relay_identity(user)
    idempotency_hash = _digest(f"{account_id}\0{idempotency_key}")
    request_hash = _digest(_canonical_payload(payload))
    existing = await get_video_task_by_idempotency(prisma_client, account_id, idempotency_hash)
    if existing is not None:
        if existing.request_hash != request_hash:
            raise SeedanceRelayError(409, "Idempotency-Key was already used with a different request")
        return CreatedSeedanceTask(existing, _stored_create_response(existing))
    provider_settings = _provider_settings()
    estimated_tokens = estimate_seedance_tokens(payload)
    price = await get_active_price(prisma_client, payload.model)
    if price is None or price.output_micros_per_million is None:
        raise SeedanceRelayError(400, "Seedance pricing is not configured")
    request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"seedance:{account_id}:{idempotency_hash}"))
    try:
        await reserve_request(
            prisma_client,
            account_id,
            request_id,
            payload.model,
            0,
            estimated_tokens,
            False,
            payload.execution_expires_after + 3600,
            price,
        )
    except ArithmeticError as exc:
        raise SeedanceRelayError(402, "Insufficient balance", "insufficient_balance") from exc
    except (LookupError, PermissionError, ValueError) as exc:
        raise SeedanceRelayError(400, str(exc)) from exc
    client = SeedanceClient(http_client, provider_settings)
    result = await client.create_task(payload, f"relay-{idempotency_hash}")
    if isinstance(result, SeedanceFailure):
        await release_request(prisma_client, request_id)
        raise _provider_error(result)
    parsed = parse_create_response(result)
    if isinstance(parsed, SeedanceFailure):
        await release_request(prisma_client, request_id)
        raise _provider_error(parsed)
    task = await create_video_task(
        prisma_client,
        request_id,
        account_id,
        key_id,
        idempotency_hash,
        request_hash,
        parsed.id,
        parsed.task_id,
        payload.model,
        payload.duration,
        payload.resolution,
        payload.ratio,
        payload.generate_audio,
        estimated_tokens,
        result.payload,
    )
    if task.request_hash != request_hash:
        raise SeedanceRelayError(409, "Idempotency-Key was already used with a different request")
    return CreatedSeedanceTask(task, _stored_create_response(task))


async def get_and_refresh_seedance_task(
    prisma_client: PrismaClient,
    user: UserAPIKeyAuth,
    task_id: str,
    http_client: httpx.AsyncClient,
) -> dict[str, object]:
    account_id, _ = relay_identity(user)
    task = await get_video_task(prisma_client, account_id, task_id)
    if task is None:
        raise SeedanceRelayError(404, "Task not found", "not_found_error")
    if task.completed_at is not None:
        return _stored_response(task)
    return await poll_seedance_task(prisma_client, task, http_client)


async def poll_seedance_task(
    prisma_client: PrismaClient,
    task: VideoTaskRow,
    http_client: httpx.AsyncClient,
) -> dict[str, object]:
    result = await SeedanceClient(http_client, _provider_settings()).get_task(task.provider_task_id)
    if isinstance(result, SeedanceFailure):
        await record_video_poll_failure(prisma_client, task.video_task_id, result.message)
        raise _provider_error(result)
    parsed = parse_status_response(result)
    if isinstance(parsed, SeedanceFailure):
        await record_video_poll_failure(prisma_client, task.video_task_id, parsed.message)
        raise _provider_error(parsed)
    normalized_status = parsed.status.strip().lower()
    actual_tokens = parsed.usage.total_tokens if parsed.usage is not None else None
    charged_micros = task.charged_micros
    upstream_cost_micros = task.upstream_cost_micros
    terminal = normalized_status in SUCCESS_STATUSES or normalized_status in FAILURE_STATUSES
    if normalized_status in SUCCESS_STATUSES:
        billable_tokens = actual_tokens if actual_tokens is not None else task.estimated_tokens
        provider_settings = _provider_settings()
        upstream_cost_micros = token_charge_micros(
            billable_tokens,
            provider_settings.upstream_micros_per_million,
        )
        charged_micros = await settle_request(
            prisma_client,
            task.request_id,
            UsageQuantity(input_tokens=0, output_tokens=billable_tokens),
            upstream_cost_micros,
        )
    elif normalized_status in FAILURE_STATUSES:
        await release_request(prisma_client, task.request_id)
    updated = await update_video_task(
        prisma_client,
        task.video_task_id,
        normalized_status,
        actual_tokens,
        charged_micros,
        upstream_cost_micros,
        result.payload,
        None,
        terminal,
    )
    return _stored_response(updated)


def relay_identity(user: UserAPIKeyAuth) -> tuple[str, str]:
    if not is_public_relay_key(user) or not isinstance(user.metadata, dict):
        raise SeedanceRelayError(403, "A public relay API key is required", "authentication_error")
    metadata = TypeAdapter(dict[str, object]).validate_python(user.metadata)
    account_id = metadata.get("public_relay_account_id")
    key_id = user.api_key or user.token
    if not isinstance(account_id, str) or not isinstance(key_id, str):
        raise SeedanceRelayError(403, "A public relay API key is required", "authentication_error")
    return account_id, key_id


def _provider_settings() -> SeedanceSettings:
    value = SeedanceSettings.from_env()
    if not value.configured():
        raise SeedanceRelayError(503, "Seedance provider is not configured", "service_unavailable")
    return value


def _provider_error(result: SeedanceFailure) -> SeedanceRelayError:
    status_code = result.status_code if 400 <= result.status_code < 500 else 502
    error_type = "provider_request_error" if status_code < 500 else "provider_unavailable"
    return SeedanceRelayError(status_code, result.message, error_type)


def _stored_create_response(task: VideoTaskRow) -> SeedanceTaskCreateResponse:
    try:
        return SeedanceTaskCreateResponse.model_validate(_stored_response(task))
    except ValidationError as exc:
        raise SeedanceRelayError(500, "Stored Seedance task is invalid", "server_error") from exc


def _stored_response(task: VideoTaskRow) -> dict[str, object]:
    try:
        return TypeAdapter(dict[str, object]).validate_python(task.provider_response)
    except ValidationError as exc:
        raise SeedanceRelayError(500, "Stored Seedance response is invalid", "server_error") from exc


def _canonical_payload(payload: SeedanceTaskCreateRequest) -> str:
    return json.dumps(payload.model_dump(mode="json", exclude_none=True), sort_keys=True, separators=(",", ":"))


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
