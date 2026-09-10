"""Rate-limit client identity behind the trusted Next.js proxy.

Every browser and Android request reaches FastAPI through the Next proxy, so
keying limits on the ASGI peer address collapses them into one global bucket:
the bridge-pairing brute-force bound becomes a platform-wide denial of service
and a handful of devices exhausts the whole write allowance. These tests pin
the two properties that matter:

  1. With a valid proxy secret, a declared client identity is honoured, so
     distinct clients get distinct buckets.
  2. Without the secret -- or with a wrong one -- a client can NEVER choose its
     own bucket by sending a header.
"""

from __future__ import annotations

import pytest

from app.security import client_identity

SECRET = "proxy-shared-secret-for-tests-only"


def _scope(peer: str = "10.0.0.1", **headers: str) -> dict:
    return {
        "type": "http",
        "client": (peer, 54321),
        "headers": [(k.replace("_", "-").encode(), v.encode()) for k, v in headers.items()],
    }


# ---------------------------------------------------------------------------
# No secret configured: peer only, exactly as before this change.
# ---------------------------------------------------------------------------
def test_without_a_secret_the_peer_is_the_identity():
    assert client_identity(_scope(peer="203.0.113.9"), "") == "peer:203.0.113.9"


def test_without_a_secret_forwarded_headers_are_ignored():
    scope = _scope(
        peer="10.0.0.1",
        x_vitalis_client="198.51.100.7",
        x_forwarded_for="198.51.100.7",
    )
    assert client_identity(scope, "") == "peer:10.0.0.1"


def test_missing_client_returns_a_stable_key():
    assert client_identity({"type": "http", "headers": []}, "") == "peer:unknown"


# ---------------------------------------------------------------------------
# Secret configured and valid: the declared identity is used.
# ---------------------------------------------------------------------------
def test_valid_secret_honours_the_declared_client():
    scope = _scope(x_vitalis_proxy_secret=SECRET, x_vitalis_client="198.51.100.7")
    assert client_identity(scope, SECRET) == "fwd:198.51.100.7"


def test_distinct_clients_get_distinct_buckets():
    keys = {
        client_identity(
            _scope(x_vitalis_proxy_secret=SECRET, x_vitalis_client=ip), SECRET
        )
        for ip in ("198.51.100.7", "198.51.100.8", "2001:db8::1")
    }
    assert len(keys) == 3


def test_forwarded_for_fallback_uses_the_rightmost_hop():
    """The left-most entries are client-supplied and must not be trusted."""
    scope = _scope(
        x_vitalis_proxy_secret=SECRET,
        x_forwarded_for="1.2.3.4, 5.6.7.8, 198.51.100.7",
    )
    assert client_identity(scope, SECRET) == "fwd:198.51.100.7"


# ---------------------------------------------------------------------------
# The security boundary: a wrong/absent secret can never pick a bucket.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("presented", ["", "wrong", SECRET + "x", SECRET[:-1], SECRET.upper()])
def test_wrong_secret_falls_back_to_the_peer(presented):
    scope = _scope(
        peer="10.0.0.1",
        x_vitalis_proxy_secret=presented,
        x_vitalis_client="198.51.100.7",
    )
    assert client_identity(scope, SECRET) == "peer:10.0.0.1"


def test_a_client_cannot_spoof_an_identity_without_the_secret():
    """The whole point: no header alone buys you a private rate-limit bucket."""
    for attempt in range(5):
        scope = _scope(
            peer="10.0.0.1",
            x_vitalis_client=f"198.51.100.{attempt}",
            x_forwarded_for=f"198.51.100.{attempt}",
        )
        assert client_identity(scope, SECRET) == "peer:10.0.0.1"


@pytest.mark.parametrize("hostile", [
    "a" * 200,                     # oversized
    "198.51.100.7 evil",           # space-separated junk
    "client;DROP TABLE app_vitals",
    "../../etc/passwd",
    "<script>alert(1)</script>",
    "",
    "   ",
])
def test_hostile_declared_identities_are_rejected(hostile):
    """A rejected identity must degrade to the peer, never be stored as a key."""
    scope = _scope(peer="10.0.0.1", x_vitalis_proxy_secret=SECRET, x_vitalis_client=hostile)
    assert client_identity(scope, SECRET) == "peer:10.0.0.1"


def test_hostile_forwarded_for_is_rejected():
    scope = _scope(peer="10.0.0.1", x_vitalis_proxy_secret=SECRET,
                   x_forwarded_for="1.2.3.4, not an address")
    assert client_identity(scope, SECRET) == "peer:10.0.0.1"


def test_peer_and_forwarded_namespaces_cannot_collide():
    """A forwarded identity must never be able to impersonate a peer bucket."""
    peer_key = client_identity(_scope(peer="198.51.100.7"), SECRET)
    fwd_key = client_identity(
        _scope(peer="10.0.0.1", x_vitalis_proxy_secret=SECRET,
               x_vitalis_client="198.51.100.7"),
        SECRET,
    )
    assert peer_key == "peer:198.51.100.7"
    assert fwd_key == "fwd:198.51.100.7"
    assert peer_key != fwd_key
