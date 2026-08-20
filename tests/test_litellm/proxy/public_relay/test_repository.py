from contextlib import asynccontextmanager

import pytest

from litellm.proxy.public_relay.repository import adjust_wallet


class _FakeTransaction:
    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    async def query_raw(self, query: str, *args: object) -> object:
        if "LedgerEntry" in query:
            return []
        return [
            {
                "wallet_id": args[0],
                "account_id": "account-1",
                "available_micros": 2_000_000,
                "reserved_micros": 250_000,
            }
        ]

    async def execute_raw(self, query: str, *args: object) -> int:
        self.executed.append((query, args))
        return 1


class _FakeDatabase:
    def __init__(self, transaction: _FakeTransaction) -> None:
        self.transaction = transaction

    @asynccontextmanager
    async def tx(self):
        yield self.transaction


class _FakePrisma:
    def __init__(self, database: _FakeDatabase) -> None:
        self.db = database


@pytest.mark.asyncio
async def test_adjust_wallet_inserts_only_deployed_ledger_columns() -> None:
    transaction = _FakeTransaction()
    prisma = _FakePrisma(_FakeDatabase(transaction))

    result = await adjust_wallet(
        prisma,  # type: ignore[arg-type]
        "wallet-1",
        100_000,
        "regression test",
        "adjustment-1",
    )

    ledger_query, ledger_args = transaction.executed[1]
    assert '"debt_after_micros"' not in ledger_query
    assert '"idempotency_key"' in ledger_query
    assert len(ledger_args) == 7
    assert result.available_micros == 2_100_000
