async function main() {
  const login = await fetch('https://mgl-progress-api.mglenc-design.workers.dev/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password' }),
  });

  if (!login.ok) {
    console.error('Login failed:', await login.text());
    return;
  }

  const token = (await login.json()).token;

  const res = await fetch('https://mgl-progress-api.mglenc-design.workers.dev/api/projects/1', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error('Projects API failed:', res.status, await res.text());
  } else {
    console.log('Projects API OK:', await res.json());
  }
}

main();
