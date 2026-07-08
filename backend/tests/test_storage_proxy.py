from types import SimpleNamespace

from app.core import storage


def test_supabase_host_is_added_to_no_proxy(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1")
    monkeypatch.delenv("no_proxy", raising=False)
    monkeypatch.setattr(
        storage,
        "settings",
        SimpleNamespace(supabase_url="https://project-ref.supabase.co"),
    )

    storage._ensure_supabase_bypasses_local_proxy()

    assert "project-ref.supabase.co" in storage.os.environ["NO_PROXY"].split(",")
    assert ".supabase.co" in storage.os.environ["NO_PROXY"].split(",")
    assert "project-ref.supabase.co" in storage.os.environ["no_proxy"].split(",")
    assert ".supabase.co" in storage.os.environ["no_proxy"].split(",")