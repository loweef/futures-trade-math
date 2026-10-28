"""futures-trade-math: cost and risk formulas for linear (USDT-margined) crypto futures.

Zero dependencies. All rates are decimal fractions (0.0005 = 0.05%).
The JavaScript module in ../js implements the same functions; both are checked
against ../test-vectors.json.
"""

import math

__all__ = [
    "round_trip_fee",
    "funding_cost",
    "break_even_price",
    "break_even_win_rate",
    "effective_reward_risk",
    "position_size",
    "liquidation_price_isolated",
    "funding_apr",
]

__version__ = "0.1.0"

_SIDES = ("long", "short")
_HOURS_PER_DAY = 24
_DAYS_PER_YEAR = 365


def _finite(name, value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number, got {value!r}")


def _positive(name, value):
    _finite(name, value)
    if value <= 0:
        raise ValueError(f"{name} must be > 0, got {value!r}")


def _non_negative(name, value):
    _finite(name, value)
    if value < 0:
        raise ValueError(f"{name} must be >= 0, got {value!r}")


def _fee_rate(name, value):
    _finite(name, value)
    if value <= -1 or value >= 1:
        raise ValueError(f"{name} must be in (-1, 1), got {value!r}")


def _fraction(name, value):
    _finite(name, value)
    if value <= 0 or value >= 1:
        raise ValueError(f"{name} must be in (0, 1), got {value!r}")


def _side_sign(side):
    if side not in _SIDES:
        raise ValueError(f'side must be "long" or "short", got {side!r}')
    return 1 if side == "long" else -1


def round_trip_fee(notional, entry_fee_rate, exit_fee_rate, exit_notional=None):
    """Round-trip trading fee.

        fee = N_entry * f_entry + N_exit * f_exit

    N_exit defaults to N_entry (exit at the entry price).
    A negative fee rate (maker rebate) lowers the total.
    """
    if exit_notional is None:
        exit_notional = notional
    _non_negative("notional", notional)
    _non_negative("exit_notional", exit_notional)
    _fee_rate("entry_fee_rate", entry_fee_rate)
    _fee_rate("exit_fee_rate", exit_fee_rate)
    return notional * entry_fee_rate + exit_notional * exit_fee_rate


def funding_cost(notional, funding_rate, settlements, side):
    """Funding paid while holding a perpetual position.

        F = N * r * n * s      s = +1 long, -1 short

    r is the funding rate per settlement interval, n the number of settlements held
    (fractional values give an expected cost, e.g. holding_hours / interval_hours).
    Positive result = the position pays; negative = the position receives.
    """
    _non_negative("notional", notional)
    _finite("funding_rate", funding_rate)
    _non_negative("settlements", settlements)
    return notional * funding_rate * settlements * _side_sign(side)


def break_even_price(side, entry_price, quantity, entry_fee_rate, exit_fee_rate, funding=0.0):
    """Exact break-even exit price, with the exit fee charged at the break-even price.

        Long:  q (P - E) = q E f_in + q P f_out + F  =>  P = (E (1 + f_in) + F / q) / (1 - f_out)
        Short: q (E - P) = q E f_in + q P f_out + F  =>  P = (E (1 - f_in) - F / q) / (1 + f_out)

    E entry price, q quantity (base units), F funding paid (see funding_cost).
    """
    s = _side_sign(side)
    _positive("entry_price", entry_price)
    _positive("quantity", quantity)
    _fee_rate("entry_fee_rate", entry_fee_rate)
    _fee_rate("exit_fee_rate", exit_fee_rate)
    _finite("funding", funding)
    return (entry_price * (1 + s * entry_fee_rate) + s * funding / quantity) / (1 - s * exit_fee_rate)


def break_even_win_rate(reward, risk, cost=0.0):
    """Break-even win rate for a fixed reward/risk with a per-trade cost.

        p (W - c) = (1 - p) (L + c)   =>   p = (L + c) / (W + L)

    W reward (target distance), L risk (stop distance), c round-trip cost per trade,
    all in the same unit (price, percent or currency).
    """
    _positive("reward", reward)
    _positive("risk", risk)
    _non_negative("cost", cost)
    return (risk + cost) / (reward + risk)


def effective_reward_risk(reward, risk, cost=0.0):
    """Reward/risk ratio after costs.

        RR_net = (W - c) / (L + c)

    Consistent with break_even_win_rate: p = 1 / (1 + RR_net).
    """
    _positive("reward", reward)
    _positive("risk", risk)
    _non_negative("cost", cost)
    return (reward - cost) / (risk + cost)


def position_size(equity, risk_fraction, entry_price, stop_price, entry_fee_rate=0.0, exit_fee_rate=0.0):
    """Position size (base units) so that a stop-out loses exactly equity * risk_fraction,
    including the entry fee and the exit fee charged at the stop price.

        q (|E - S| + E f_in + S f_out) = A r   =>   q = A r / (|E - S| + E f_in + S f_out)

    Notional = q * E. Funding and slippage are not included.
    """
    _positive("equity", equity)
    _fraction("risk_fraction", risk_fraction)
    _positive("entry_price", entry_price)
    _positive("stop_price", stop_price)
    _fee_rate("entry_fee_rate", entry_fee_rate)
    _fee_rate("exit_fee_rate", exit_fee_rate)
    if entry_price == stop_price:
        raise ValueError("stop_price must differ from entry_price")
    loss_per_unit = abs(entry_price - stop_price) + entry_price * entry_fee_rate + stop_price * exit_fee_rate
    if loss_per_unit <= 0:
        raise ValueError("loss per unit at the stop must be > 0")
    return equity * risk_fraction / loss_per_unit


def liquidation_price_isolated(side, entry_price, leverage, maintenance_margin_rate):
    """Approximate isolated-margin liquidation price with a flat maintenance margin rate.

        Long:  P_liq = E (1 - 1/lev + mmr)
        Short: P_liq = E (1 + 1/lev - mmr)

    Ignores tiered maintenance margin, fees, funding and added margin.
    """
    s = _side_sign(side)
    _positive("entry_price", entry_price)
    _positive("leverage", leverage)
    _finite("maintenance_margin_rate", maintenance_margin_rate)
    if maintenance_margin_rate < 0 or maintenance_margin_rate >= 1:
        raise ValueError(f"maintenance_margin_rate must be in [0, 1), got {maintenance_margin_rate!r}")
    return entry_price * (1 - s / leverage + s * maintenance_margin_rate)


def funding_apr(funding_rate, interval_hours=8):
    """Annualized funding rate (simple, not compounded).

        APR = r * (24 / h) * 365

    r funding rate per interval, h interval length in hours.
    """
    _finite("funding_rate", funding_rate)
    _positive("interval_hours", interval_hours)
    return funding_rate * (_HOURS_PER_DAY / interval_hours) * _DAYS_PER_YEAR
