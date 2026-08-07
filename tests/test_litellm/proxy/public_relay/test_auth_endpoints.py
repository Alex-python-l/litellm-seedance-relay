import pytest
from fastapi import HTTPException, Response

from litellm.proxy.public_relay import auth_endpoints
from litellm.proxy.public_relay.api_types import ActivateRequest, PasswordResetRequest


@pytest.mark.asyncio
async def test_activate_reports_password_policy_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_endpoints, "settings", lambda: object())
    payload = ActivateRequest(token="t" * 32, password="abcdefghijkl")

    with pytest.raises(HTTPException) as raised:
        await auth_endpoints.activate(payload, Response())

    assert raised.value.status_code == 400
    assert raised.value.detail == {
        "error": {
            "message": "password must contain upper-case, lower-case, and numeric characters",
            "type": "validation_error",
        }
    }


@pytest.mark.asyncio
async def test_password_reset_reports_password_policy_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_endpoints, "settings", lambda: object())
    payload = PasswordResetRequest(token="t" * 32, password="too-short")

    with pytest.raises(HTTPException) as raised:
        await auth_endpoints.password_reset(payload)

    assert raised.value.status_code == 400
    assert raised.value.detail["error"]["type"] == "validation_error"
    assert "12 and 128" in raised.value.detail["error"]["message"]


def test_invalid_links_have_an_actionable_error() -> None:
    error = auth_endpoints._link_failure("Activation")

    assert error.status_code == 400
    assert error.detail["error"]["message"] == "Activation link is invalid, expired, or already used"
