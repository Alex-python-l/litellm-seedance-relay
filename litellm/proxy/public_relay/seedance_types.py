from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

SEEDANCE_MODEL = "doubao-seedance-2-0-260128"


class SeedanceMediaUrl(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: HttpUrl


class SeedanceContentItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["text", "image_url", "video_url", "audio_url"]
    text: str | None = Field(default=None, min_length=1, max_length=20_000)
    image_url: SeedanceMediaUrl | None = None
    video_url: SeedanceMediaUrl | None = None
    audio_url: SeedanceMediaUrl | None = None
    role: Literal["reference_image", "first_frame", "last_frame", "reference_video", "reference_audio"] | None = None

    @model_validator(mode="after")
    def validate_content(self) -> SeedanceContentItem:
        values = {
            "text": self.text,
            "image_url": self.image_url,
            "video_url": self.video_url,
            "audio_url": self.audio_url,
        }
        if values[self.type] is None or sum(value is not None for value in values.values()) != 1:
            raise ValueError("content type must match exactly one content value")
        valid_roles = {
            "text": {None},
            "image_url": {"reference_image", "first_frame", "last_frame"},
            "video_url": {"reference_video"},
            "audio_url": {"reference_audio"},
        }
        if self.role not in valid_roles[self.type]:
            raise ValueError("content role is not valid for the selected content type")
        return self


class SeedanceTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["web_search"]


class SeedanceTaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: Literal["doubao-seedance-2-0-260128"] = SEEDANCE_MODEL
    content: tuple[SeedanceContentItem, ...] = Field(min_length=1, max_length=16)
    generate_audio: bool = True
    ratio: Literal["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] = "adaptive"
    duration: Literal[-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] = 5
    resolution: Literal["480p", "720p", "1080p", "4k"] = "720p"
    watermark: bool = False
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    return_last_frame: bool = False
    tools: tuple[SeedanceTool, ...] = ()
    callback_url: HttpUrl | None = None
    execution_expires_after: int = Field(default=172_800, ge=3_600, le=259_200)
    safety_identifier: str | None = Field(default=None, max_length=64)
    priority: int = Field(default=0, ge=0, le=9)


class SeedanceTaskCreateResponse(BaseModel):
    id: str
    task_id: str


class SeedanceUsage(BaseModel):
    total_tokens: int = Field(ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)


class SeedanceTaskStatus(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    task_id: str | None = None
    model: str | None = None
    status: str
    usage: SeedanceUsage | None = None
    content: object | None = None
    duration: int | None = None
    resolution: str | None = None
    ratio: str | None = None


class SeedanceProviderStatusResponse(BaseModel):
    configured: bool
    connected: bool | None = None
    model: str
    api_base_url: str
    upstream_micros_per_million: int
    detail: str | None = None


@dataclass(frozen=True, slots=True)
class SeedanceSettings:
    api_base_url: str
    api_key: str
    model: str
    upstream_micros_per_million: int

    @classmethod
    def from_env(cls) -> SeedanceSettings:
        return cls(
            api_base_url=os.getenv("SEEDANCE_API_BASE_URL", "https://api.aitaotech.com/api/v1").rstrip("/"),
            api_key=os.getenv("SEEDANCE_API_KEY", "").strip(),
            model=os.getenv("SEEDANCE_MODEL", SEEDANCE_MODEL).strip(),
            upstream_micros_per_million=int(os.getenv("SEEDANCE_UPSTREAM_MICROS_PER_MILLION", "0")),
        )

    def configured(self) -> bool:
        return (
            self.api_base_url.startswith("https://")
            and bool(self.api_key)
            and self.model == SEEDANCE_MODEL
            and self.upstream_micros_per_million >= 0
        )


def estimate_seedance_tokens(payload: SeedanceTaskCreateRequest) -> int:
    return (seedance_video_tokens(payload) * 18 + 9) // 10


def seedance_video_tokens(payload: SeedanceTaskCreateRequest) -> int:
    short_side = {"480p": 480, "720p": 720, "1080p": 1080, "4k": 2160}[payload.resolution]
    ratio = "21:9" if payload.ratio == "adaptive" else payload.ratio
    horizontal, vertical = (int(value) for value in ratio.split(":"))
    if horizontal >= vertical:
        width = round(short_side * horizontal / vertical)
        height = short_side
    else:
        width = short_side
        height = round(short_side * vertical / horizontal)
    frames = (15 if payload.duration == -1 else payload.duration) * 24 + 1
    return (width * height * frames + 1023) // 1024
