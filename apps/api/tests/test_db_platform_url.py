"""Regression tests for Postgres URL normalization.

SQLAlchemy's bare `postgresql://` scheme selects the psycopg2 driver, but
requirements.txt only installs psycopg v3. The connect() helper must
rewrite the scheme so create_engine picks the correct driver.
"""

from app.db_platform import _normalize_postgres_url


def test_postgresql_scheme_gets_psycopg_driver():
    assert (
        _normalize_postgres_url("postgresql://u:p@h:5432/d?sslmode=require")
        == "postgresql+psycopg://u:p@h:5432/d?sslmode=require"
    )


def test_postgres_scheme_is_also_normalized():
    assert (
        _normalize_postgres_url("postgres://u:p@h/d")
        == "postgresql+psycopg://u:p@h/d"
    )


def test_already_psycopg_url_is_unchanged():
    url = "postgresql+psycopg://u:p@h:5432/d?sslmode=require"
    assert _normalize_postgres_url(url) == url


def test_sqlite_url_is_unchanged():
    assert _normalize_postgres_url("sqlite:///x.db") == "sqlite:///x.db"


def test_credentials_and_query_preserved():
    src = "postgresql://user:s3cr3t%21@db.example.com:6543/postgres?sslmode=require&connect_timeout=10"
    expected = "postgresql+psycopg://user:s3cr3t%21@db.example.com:6543/postgres?sslmode=require&connect_timeout=10"
    assert _normalize_postgres_url(src) == expected
