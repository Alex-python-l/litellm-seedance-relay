from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException

from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.proxy.public_relay.runtime import database, settings
from litellm.proxy.public_relay.seedance_service import (
    SeedanceRelayError,
    create_seedance_task,
    get_and_refresh_seedance_task,
)
from litellm.proxy.public_relay.seedance_types import SeedanceTaskCreateRequest, SeedanceTaskCreateResponse

router = APIRouter(tags=["public relay Seedance"])


@router.post(
    "/api/v1/open/contents/generations/tasks",
    response_model=SeedanceTaskCreateResponse,
)
async def create_task(
    payload: SeedanceTaskCreateRequest,
    idempotency_key: Annotated[str, Header(alias="idempotency-key", min_length=8, max_length=255)],
    user: Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)],
) -> SeedanceTaskCreateResponse:
    settings()
    try:
        async with httpx.AsyncClient() as client:
            created = await create_seedance_task(database(), user, payload, idempotency_key, client)
        return created.response
    except SeedanceRelayError as exc:
        raise _http_error(exc) from exc


@router.get("/api/v1/open/contents/generations/tasks/{task_id}")
async def task_status(
    task_id: str,
    user: Annotated[UserAPIKeyAuth, Depends(user_api_key_auth)],
) -> dict[str, object]:
    settings()
    try:
        async with httpx.AsyncClient() as client:
            return await get_and_refresh_seedance_task(database(), user, task_id, client)
    except SeedanceRelayError as exc:
        raise _http_error(exc) from exc


def _http_error(error: SeedanceRelayError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={"error": {"message": error.message, "type": error.error_type}},
    )
