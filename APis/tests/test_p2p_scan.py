import pytest

from app.p2p import best_arb_margin_pct, scan_arbitrage


def _state():
    return {
        "ts": 123,
        "source": "test",
        "methods": {
            "Bank Transfer": {"buy": {"best": 280.0}, "sell": {"best": 285.0}},
            "Easypaisa": {"buy": {"best": 283.0}, "sell": {"best": 284.0}},
            "JazzCash": {"buy": {"best": 284.0}, "sell": {"best": 283.0}},  # negative
        },
    }


def test_scan_arbitrage_ranks_methods():
    scan = scan_arbitrage(_state(), interbank=277.0)
    rows = scan["rows"]
    assert [r["method"] for r in rows] == ["Bank Transfer", "Easypaisa", "JazzCash"]
    assert rows[0]["margin"] == 5.0
    assert rows[0]["margin_pct"] == pytest.approx(1.786, abs=0.001)
    assert rows[0]["premium_pct"] == pytest.approx((280 - 277) / 277 * 100, abs=0.001)
    assert rows[2]["margin"] == -1.0  # sell < buy loses money


def test_scan_arbitrage_cross_and_threshold():
    scan = scan_arbitrage(_state(), interbank=277.0)
    assert scan["cross"]["best_buy"] == 280.0
    assert scan["cross"]["best_sell"] == 285.0
    assert scan["cross"]["margin"] == 5.0
    # default threshold is 1.0% -> only Bank Transfer qualifies as an opportunity
    assert [o["method"] for o in scan["opportunities"]] == ["Bank Transfer"]
    assert scan["arb_threshold_pct"] == 1.0


def test_scan_arbitrage_handles_missing_data():
    scan = scan_arbitrage({"methods": {}}, interbank=None)
    assert scan["rows"] == []
    assert scan["opportunities"] == []
    assert scan["cross"]["margin"] is None
    assert best_arb_margin_pct(scan) is None
