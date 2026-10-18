const url = process.argv[2];
const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try { if ((await fetch(url)).ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) { console.error("The local notes server did not become ready."); process.exitCode = 1; }
