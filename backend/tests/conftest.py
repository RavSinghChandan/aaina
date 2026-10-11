"""With TEST_DATABASE_URL set (CI sets a Postgres one), every app in the tests uses that database, emptied first."""
import os

import pytest


@pytest.fixture(autouse=True)
def _test_database(monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        yield
        return
    from app import main
    from app.db.models import Base, make_engine

    engine = make_engine(url)
    Base.metadata.drop_all(engine)
    engine.dispose()
    monkeypatch.setattr(main, "make_engine", lambda _url=None: make_engine(url))
    yield
