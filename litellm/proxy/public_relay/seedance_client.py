from __future__ import annotations

from dataclasses import dataclass

import httpx
from pydantic import TypeAdapter, ValidationError

from litellm.proxy.public_relay.seedance_types import (
    SeedanceSettings,
    SeedanceTaskCreateRequest,
    SeedanceTaskCreateResponse,
    SeedanceTaskStatus,
)


@dataclass(frozen=True, slots=True)
class SeedanceSuccess:
    status_code: int
    payload: dict[str, object]


@dataclass(frozen=True, slots=True)
class SeedanceFailure:
    status_code: int
    message: str
    payload: dict[str, object] | None = None


SeedanceResult = SeedanceSuccess | SeedanceFailure


class SeedanceClient:
    def __init__(self, client: httpx.AsyncClient, settings: SeedanceSettings) -> None:
        self._client = client
        self._settings = settings

    async def create_task(self, payload: SeedanceTaskCreateRequest, idempotency_key: str) -> SeedanceResult:
        return await self._request(
            "POST",
            "/open/contents/generations/tasks",
            payload=payload.model_dump(mode="json", exclude_none=True),
            idempotency_key=idempotency_key,
        )

    async def get_task(self, task_id: str) -> SeedanceResult:
        return await self._request("GET", f"/open/contents/generations/tasks/{task_id}")

    async def test_connection(self) -> SeedanceResult:
        return await self._request("POST", "/open/contents/generations/tasks", payload={})

    async def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
        idempotency_key: str | None = None,
    ) -> SeedanceResult:
        headers = {"authorization": f"Bearer {self._settings.api_key}"}
        if idempotency_key is not None:
            headers["idempotency-key"] = idempotency_key
        try:
            kwargs: dict[str, object] = {"headers": headers, "timeout": 30.0}
            if payload is not None:
                kwargs["json"] = payload
            response = await self._client.request(method, f"{self._settings.api_base_url}{path}", **kwargs)
        except httpx.HTTPError as exc:
            return SeedanceFailure(status_code=502, message=str(exc))
        try:
            data = TypeAdapter(dict[str, object]).validate_python(response.json())
        except (ValueError, ValidationError):
            return SeedanceFailure(status_code=502, message="Seedance provider returned an invalid response")
        if response.is_success:
            return SeedanceSuccess(status_code=response.status_code, payload=data)
        return SeedanceFailure(
            status_code=response.status_code,
            message=_error_message(data),
            payload=data,
        )


def parse_create_response(result: SeedanceSuccess) -> SeedanceTaskCreateResponse | SeedanceFailure:
    try:
        return SeedanceTaskCreateResponse.model_validate(result.payload)
    except ValidationError:
        return SeedanceFailure(status_code=502, message="Seedance provider omitted the task identifier")


def parse_status_response(result: SeedanceSuccess) -> SeedanceTaskStatus | SeedanceFailure:
    try:
        return SeedanceTaskStatus.model_validate(result.payload)
    except ValidationError:
        return SeedanceFailure(status_code=502, message="Seedance provider returned an invalid task status")


def _error_message(payload: dict[str, object]) -> str:
    message = payload.get("message")
    if isinstance(message, str) and message.strip():
        return message
    error = payload.get("error")
    if not isinstance(error, dict):
        return "Seedance provider request failed"
    message = error.get("message")
    return message if isinstance(message, str) and message.strip() else "Seedance provider request failed"
