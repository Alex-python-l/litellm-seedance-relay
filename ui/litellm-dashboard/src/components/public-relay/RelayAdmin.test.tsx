import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RelayAdmin from "./RelayAdmin";

const { relayFetchMock } = vi.hoisted(() => ({ relayFetchMock: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ accessToken: "admin-token" }),
}));

vi.mock("@/lib/http/publicRelay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/publicRelay")>();
  return { ...actual, relayFetch: relayFetchMock };
});

const resetUrl = "https://relay.example/ui/password-reset?token=reset-token";

describe("RelayAdmin password reset feedback", () => {
  beforeEach(() => {
    relayFetchMock.mockReset();
    relayFetchMock.mockImplementation(async (path: string) => {
      const responses: Record<string, unknown> = {
        "/v1/admin/relay/accounts": {
          data: [
            {
              account_id: "account-1",
              company_name: "Test Company",
              email: "admin@example.com",
              status: "ACTIVE",
              wallet_id: "wallet-1",
              available: { currency: "USD", amount_micros: "1000000", display: "$1" },
              reserved: { currency: "USD", amount_micros: "0", display: "$0" },
            },
          ],
        },
        "/v1/admin/relay/prices": { models: [] },
        "/v1/admin/relay/video-tasks?limit=50": { data: [] },
        "/v1/admin/relay/margin": {
          charged: { currency: "USD", amount_micros: "0", display: "$0" },
          upstream_cost: { currency: "USD", amount_micros: "0", display: "$0" },
          gross_margin: { currency: "USD", amount_micros: "0", display: "$0" },
        },
        "/v1/admin/relay/providers/seedance": {
          configured: true,
          connected: null,
          model: "doubao-seedance-2-0-260128",
          api_base_url: "https://provider.example",
          upstream_micros_per_million: 2_000_000,
          detail: null,
        },
        "/v1/admin/relay/accounts/account-1/password-reset-link": {
          url: resetUrl,
          expires_at: "2026-08-08T00:00:00Z",
        },
      };
      return { data: responses[path], response: new Response() };
    });
  });

  it("shows the generated reset link in a visible dialog", async () => {
    const user = userEvent.setup();
    render(<RelayAdmin />);

    await user.click(await screen.findByRole("button", { name: "重置密码" }));

    const dialog = await screen.findByRole("dialog", { name: "一次性账户链接已生成" });
    expect(within(dialog).getByText(resetUrl)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "复制链接" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
