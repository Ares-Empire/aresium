// The /login page — a self-contained, on-brand dark page (inline CSS + the Aresium mark)
// so it pulls no extra assets that would need to bypass the auth gate. Plain <form> POST,
// so it works without JavaScript. `error` renders a message after a failed attempt.
export function loginPage(error = ""): string {
  const errHtml = error
    ? `<p class="err">${error.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</p>`
    : "";
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Aresium — Sign in</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #f6f7fb;
    background:
      radial-gradient(60% 40% at 50% 24%, rgba(255,45,75,0.14), transparent 60%),
      radial-gradient(50% 50% at 50% 100%, rgba(46,139,255,0.06), transparent 60%),
      #08090c;
  }
  .card {
    width: min(92vw, 360px); padding: 34px 30px 30px; text-align: center;
    border: 1px solid rgba(255,255,255,0.08); border-radius: 20px;
    background: rgba(20,21,27,0.6); backdrop-filter: blur(20px) saturate(150%);
    -webkit-backdrop-filter: blur(20px) saturate(150%);
    box-shadow: 0 24px 70px rgba(0,0,0,0.5);
  }
  .mark { width: 56px; height: 56px; margin: 0 auto 16px; display: block; }
  h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  .sub { margin: 0 0 22px; font-size: 13.5px; color: #8b91a0; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input[type=password] {
    height: 46px; padding: 0 15px; font-size: 15px; color: #f6f7fb;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 13px;
    background: rgba(255,255,255,0.04); outline: none; transition: border-color .18s, background .18s;
  }
  input[type=password]:focus { border-color: rgba(255,45,75,0.6); background: rgba(255,255,255,0.06); }
  button {
    height: 46px; font-size: 15px; font-weight: 650; color: #fff; cursor: pointer;
    border: none; border-radius: 13px;
    background: linear-gradient(180deg, #ff3b56, #e11030);
    box-shadow: 0 8px 24px rgba(225,16,48,0.32); transition: filter .18s, transform .06s;
  }
  button:hover { filter: brightness(1.06); }
  button:active { transform: translateY(1px); }
  .err {
    margin: 0 0 14px; padding: 9px 12px; font-size: 13px; color: #ffd7dc;
    border-radius: 11px; background: rgba(225,16,48,0.16); border: 1px solid rgba(255,80,100,0.4);
  }
</style>
</head>
<body>
  <main class="card">
    <svg class="mark" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="23" height="23" rx="7" stroke="#ff2d4b" stroke-width="1.6" opacity="0.55" />
      <path d="M6 17 L11 9 L15 14 L20 6.5" stroke="#ff2d4b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="20" cy="6.5" r="2.1" fill="#ff2d4b" />
    </svg>
    <h1>Aresium</h1>
    <p class="sub">Enter your password to continue</p>
    ${errHtml}
    <form method="POST" action="/login" autocomplete="off">
      <input type="password" name="password" placeholder="Password" aria-label="Password" autofocus required />
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}
