def test_register_login_me(client):
    res = client.post(
        "/api/auth/register",
        json={"name": "Alice", "email": "alice@test.dev", "password": "hunter22"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["token"]
    assert body["user"]["email"] == "alice@test.dev"
    assert "password" not in body["user"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "alice@test.dev"


def test_duplicate_email_conflict(client):
    payload = {"name": "Bob", "email": "bob@test.dev", "password": "hunter22"}
    assert client.post("/api/auth/register", json=payload).status_code == 200
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_login_wrong_password(client):
    client.post(
        "/api/auth/register",
        json={"name": "Carol", "email": "carol@test.dev", "password": "hunter22"},
    )
    ok = client.post("/api/auth/login", json={"email": "carol@test.dev", "password": "hunter22"})
    assert ok.status_code == 200
    bad = client.post("/api/auth/login", json={"email": "carol@test.dev", "password": "wrong-pass"})
    assert bad.status_code == 401


def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_change_password_revokes_other_sessions(client):
    client.post(
        "/api/auth/register",
        json={"name": "Dave", "email": "dave@test.dev", "password": "hunter22"},
    )
    first = client.post("/api/auth/login", json={"email": "dave@test.dev", "password": "hunter22"})
    second = client.post("/api/auth/login", json={"email": "dave@test.dev", "password": "hunter22"})
    token_a, token_b = first.json()["token"], second.json()["token"]
    h_b = {"Authorization": f"Bearer {token_b}"}

    wrong = client.post(
        "/api/auth/change-password",
        json={"current_password": "not-it", "new_password": "newpass1"},
        headers=h_b,
    )
    assert wrong.status_code == 400

    same = client.post(
        "/api/auth/change-password",
        json={"current_password": "hunter22", "new_password": "hunter22"},
        headers=h_b,
    )
    assert same.status_code == 400

    ok = client.post(
        "/api/auth/change-password",
        json={"current_password": "hunter22", "new_password": "newpass1"},
        headers=h_b,
    )
    assert ok.status_code == 200
    assert "signed out" in ok.json()["message"]

    # caller's session survives, other session is revoked
    assert client.get("/api/auth/me", headers=h_b).status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_a}"}).status_code == 401

    # old password no longer works, new one does
    assert client.post("/api/auth/login", json={"email": "dave@test.dev", "password": "hunter22"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "dave@test.dev", "password": "newpass1"}).status_code == 200
