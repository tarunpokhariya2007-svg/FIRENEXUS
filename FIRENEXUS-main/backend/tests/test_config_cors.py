from app.config import Settings


def test_production_frontend_origin_is_in_default_cors_allowlist(monkeypatch):
    monkeypatch.delenv("FIRENEXUS_CORS_ORIGINS", raising=False)

    assert "https://firenexus-two.vercel.app" in Settings().CORS_ORIGINS


def test_configured_cors_origins_extend_safe_defaults(monkeypatch):
    monkeypatch.setenv("FIRENEXUS_CORS_ORIGINS", "https://preview.example.test,https://firenexus-two.vercel.app")

    origins = Settings().CORS_ORIGINS
    assert origins.count("https://firenexus-two.vercel.app") == 1
    assert "https://preview.example.test" in origins
    assert "http://localhost:5173" in origins
