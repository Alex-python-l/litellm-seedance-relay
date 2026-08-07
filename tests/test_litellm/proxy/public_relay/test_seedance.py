from datetime import datetime, timezone

import httpx
import pytest
from pydantic import ValidationError

from litellm.proxy.public_relay.db_types import VideoTaskRow
from litellm.proxy.public_relay.seedance_client import SeedanceClient, SeedanceFailure, SeedanceSuccess
from litellm.proxy.public_relay.seedance_service import (
    SeedanceRelayError,
    _canonical_payload,
    _digest,
    create_seedance_task,
    get_and_refresh_seedance_task,
    poll_seedance_task,
)
from litellm.proxy.public_relay.seedance_types import (
    SEEDANCE_MODEL,
    SeedanceContentItem,
    SeedanceSettings,
    SeedanceTaskCreateRequest,
    estimate_seedance_tokens,
    seedance_video_tokens,
)


def _payload() -> SeedanceTaskCreateRequest:
    return SeedanceTaskCreateRequest(
        content=(SeedanceContentItem(type="text", text="A paper boat at sunrise"),),
        duration=5,
        resolution="720p",
        ratio="16:9",
        generate_audio=False,
    )


def _task() -> VideoTaskRow:
    now = datetime.now(timezone.utc)
    return VideoTaskRow(
        video_task_id="video-1",
        request_id="request-1",
        account_id="account-1",
        key_id="key-1",
        idempotency_hash="idem-hash",
        request_hash="request-hash",
        provider_task_id="provider-1",
        provider_internal_task_id="internal-1",
        model_name=SEEDANCE_MODEL,
        status="running",
        duration=5,
        resolution="720p",
        ratio="16:9",
        generate_audio=False,
        estimated_tokens=196_020,
        actual_tokens=None,
        charged_micros=0,
        upstream_cost_micros=0,
        provider_response={"id": "provider-1", "task_id": "internal-1"},
        provider_error=None,
        last_polled_at=None,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )


def test_seedance_token_estimate_matches_known_720p_example() -> None:
    assert seedance_video_tokens(_payload()) == 108_900
    assert estimate_seedance_tokens(_payload()) == 196_020


def test_content_role_must_match_media_type() -> None:
    with pytest.raises(ValidationError):
        SeedanceContentItem(type="image_url", image_url={"url": "https://example.com/a.png"}, role="reference_audio")


@pytest.mark.asyncio
async def test_client_injects_provider_auth_and_idempotency() -> None:
    seen_headers: httpx.Headers | None = None
    seen_body: bytes | None = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_body, seen_headers
        seen_headers = request.headers
        seen_body = request.content
        return httpx.Response(200, json={"id": "provider-1", "task_id": "internal-1"})

    settings = SeedanceSettings(
        api_base_url="https://provider.example.test/api/v1",
        api_key="provider-secret",
        model=SEEDANCE_MODEL,
        upstream_micros_per_million=0,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await SeedanceClient(client, settings).create_task(_payload(), "relay-idempotency")

    assert isinstance(result, SeedanceSuccess)
    assert seen_headers is not None
    assert seen_headers["authorization"] == "Bearer provider-secret"
    assert seen_headers["idempotency-key"] == "relay-idempotency"
    assert seen_body is not None
    assert b"service_tier" not in seen_body


@pytest.mark.asyncio
async def test_client_preserves_top_level_provider_error_message() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "provider key is invalid"})

    settings = SeedanceSettings(
        api_base_url="https://provider.example.test/api/v1",
        api_key="provider-secret",
        model=SEEDANCE_MODEL,
        upstream_micros_per_million=0,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await SeedanceClient(client, settings).create_task(_payload(), "relay-idempotency")

    assert isinstance(result, SeedanceFailure)
    assert result.status_code == 401
    assert result.message == "provider key is invalid"


@pytest.mark.asyncio
async def test_repeated_idempotency_key_returns_stored_task(monkeypatch) -> None:
    existing = _task().model_copy(
        update={
            "request_hash": _digest(_canonical_payload(_payload())),
            "provider_response": {"id": "provider-1", "task_id": "internal-1"},
        }
    )

    async def get_existing(_prisma, account_id, _idempotency_hash):
        assert account_id == "account-1"
        return existing

    monkeypatch.setattr(
        "litellm.proxy.public_relay.seedance_service.relay_identity", lambda _user: ("account-1", "key-1")
    )
    monkeypatch.setattr("litellm.proxy.public_relay.seedance_service.get_video_task_by_idempotency", get_existing)

    created = await create_seedance_task(object(), object(), _payload(), "request-1", object())

    assert created.task == existing
    assert created.response.id == "provider-1"


@pytest.mark.asyncio
async def test_changed_payload_reusing_idempotency_key_is_rejected(monkeypatch) -> None:
    async def get_existing(_prisma, _account_id, _idempotency_hash):
        return _task()

    monkeypatch.setattr(
        "litellm.proxy.public_relay.seedance_service.relay_identity", lambda _user: ("account-1", "key-1")
    )
    monkeypatch.setattr("litellm.proxy.public_relay.seedance_service.get_video_task_by_idempotency", get_existing)

    with pytest.raises(SeedanceRelayError) as exc_info:
        await create_seedance_task(object(), object(), _payload(), "request-1", object())

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_task_lookup_is_scoped_to_authenticated_account(monkeypatch) -> None:
    looked_up: list[tuple[str, str]] = []

    async def get_task(_prisma, account_id, task_id):
        looked_up.append((account_id, task_id))
        return None

    monkeypatch.setattr(
        "litellm.proxy.public_relay.seedance_service.relay_identity", lambda _user: ("account-2", "key-2")
    )
    monkeypatch.setattr("litellm.proxy.public_relay.seedance_service.get_video_task", get_task)

    with pytest.raises(SeedanceRelayError) as exc_info:
        await get_and_refresh_seedance_task(object(), object(), "provider-1", object())

    assert looked_up == [("account-2", "provider-1")]
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_successful_task_settles_actual_tokens(monkeypatch) -> None:
    settled: list[tuple[str, int, int]] = []
    updated: list[tuple[str, int | None, bool]] = []

    async def settle(_prisma, request_id, usage, upstream_cost):
        settled.append((request_id, usage.output_tokens, upstream_cost))
        return 544_500

    async def update(_prisma, video_task_id, _status, actual_tokens, _charged, _cost, payload, _error, terminal):
        updated.append((video_task_id, actual_tokens, terminal))
        return _task().model_copy(update={"provider_response": payload})

    monkeypatch.setenv("SEEDANCE_API_KEY", "provider-secret")
    monkeypatch.setenv("SEEDANCE_UPSTREAM_MICROS_PER_MILLION", "2000000")
    monkeypatch.setattr("litellm.proxy.public_relay.seedance_service.settle_request", settle)
    monkeypatch.setattr("litellm.proxy.public_relay.seedance_service.update_video_task", update)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "provider-1",
                "task_id": "internal-1",
                "status": "succeeded",
                "usage": {"total_tokens": 108900},
                "content": {"video_url": "https://example.com/video.mp4"},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        response = await poll_seedance_task(object(), _task(), client)

    assert response["status"] == "succeeded"
    assert settled == [("request-1", 108_900, 217_800)]
    assert updated == [("video-1", 108_900, True)]


@pytest.mark.asyncio
async def test_failed_task_releases_reserved_balance(monkeypatch) -> None:
    released: list[str] = []
    updated: list[tuple[str, str, bool]] = []

    async def release(_prisma, request_id):
        released.append(request_id)

    async def update(_prisma, video_task_id, status, _actual_tokens, _charged, _cost, payload, _error, terminal):
        updated.append((video_task_id, status, terminal))
        return _task().model_copy(update={"status": status, "provider_response": payload})

    monkeypatch.setenv("SEEDANCE_API_KEY", "provider-secret")
    monkeypatch.setattr("litellm.proxy.public_relay.seedance_service.release_request", release)
    monkeypatch.setattr("litellm.proxy.public_relay.seedance_service.update_video_task", update)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "provider-1",
                "task_id": "internal-1",
                "status": "failed",
                "error": {"message": "generation failed"},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        response = await poll_seedance_task(object(), _task(), client)

    assert response["status"] == "failed"
    assert released == ["request-1"]
    assert updated == [("video-1", "failed", True)]
