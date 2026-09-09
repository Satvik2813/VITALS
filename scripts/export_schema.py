"""Export schema from SQLAlchemy into an existing CLI-created migration file."""

import sys
from pathlib import Path

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.database import metadata


def schema() -> str:
    dialect = postgresql.dialect()
    statements = ["-- VITALIS: private backend access only; no browser grants.\nBEGIN;"]
    for table in metadata.sorted_tables:
        statements.append(str(CreateTable(table).compile(dialect=dialect)).strip() + ";")
        for index in sorted(table.indexes, key=lambda i: i.name):
            statements.append(str(CreateIndex(index).compile(dialect=dialect)) + ";")
        statements.append(f"ALTER TABLE public.{table.name} ENABLE ROW LEVEL SECURITY;")
        statements.append(f"REVOKE ALL ON public.{table.name} FROM anon, authenticated;")
    statements.extend(
        [
            "CREATE UNIQUE INDEX one_active_demo_run ON public.demo_runs (active) WHERE active = true;",
            "-- No permissive RLS policies: anon/authenticated cannot access any rows.",
            "-- Backend uses a server-only PostgreSQL connection; never put credentials in NEXT_PUBLIC_.",
            "COMMIT;",
        ]
    )
    return "\n\n".join(statements) + "\n"


if __name__ == "__main__":
    path = Path(sys.argv[1])
    if not path.is_file() or path.parent.name != "migrations":
        raise SystemExit("First create a migration with supabase migration new")
    path.write_text(schema(), encoding="utf-8")
    print(f"Wrote {len(metadata.tables)} tables with RLS to {path}")
