// The owner opens the page once with #owner=<OWNER_TOKEN> to search the private books too; the key stays in this tab only.
function ownerKey() {
  try {
    const m = location.hash.match(/owner=([^&]+)/);
    if (m) { sessionStorage.setItem("owner", decodeURIComponent(m[1])); history.replaceState(null, "", location.pathname + location.search); }
    return sessionStorage.getItem("owner") ?? "";
  } catch { return ""; }
}
// The demo page: the same API the Keystone panel uses.
const $ = s => document.querySelector(s);
const sessionId = (() => { try { return localStorage.jurySession ??= crypto.randomUUID(); } catch { return crypto.randomUUID(); } })();
const lang = navigator.language.startsWith("de") ? "de" : "en";

const sample = { name: "Primary school, Munich", typology: "school", country: "DE", city: "Munich", gfa: 6400, storeys: 3, grz: 0.35, gfz: 0.9,
  facade: "brick with deep reveals", structure: "timber-hybrid, CLT slabs", style: "Brick: pillars and deep reveals",
  materials: ["red brick", "oak", "light render"], landscape: "green schoolyard with old trees",
  concept: "All-day school with four learning clusters around a planted court; the hall opens to the street." };
$("#project").value = JSON.stringify(sample, null, 2);

document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll(".tab").forEach(t => t.hidden = t.id !== b.dataset.tab);
});

async function api(path, body) {
  const headers = { "content-type": "application/json", ...(ownerKey() ? { authorization: `Bearer ${ownerKey()}` } : {}) };
  const res = await fetch(path, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function citeList(citations) {
  const ol = el("ol", "cites");
  for (const c of citations) {
    const li = el("li");
    const a = el("a", null, `${c.author}, ${c.title}, ${c.where}`);
    if (c.url) { a.href = c.url; a.target = "_blank"; a.rel = "noopener"; }
    li.append(a, el("div", null, `“${c.quote}”`));
    ol.append(li);
  }
  return ol;
}

$("#ask-form").onsubmit = async e => {
  e.preventDefault();
  const q = $("#question").value.trim();
  if (!q) return;
  const btn = e.submitter; btn.disabled = true;
  $("#log").append(el("li", "q", q));
  const li = el("li", null, "…"); $("#log").append(li);
  $("#question").value = "";
  try {
    const r = await api("/api/ask", { sessionId, message: q, lang, project: JSON.parse($("#project").value || "{}") });
    li.textContent = r.answer;
    if (r.citations?.length) li.append(citeList(r.citations));
    for (const f of r.facts ?? []) li.append(el("p", "note", `Saved to Keystone's knowledge base: ${f.en} (${f.status}, confidence ${f.confidence})`));
  } catch (err) { li.textContent = err.message; }
  btn.disabled = false;
};

// voice: record with the microphone, Whisper on the Worker turns it into text
function mic(button, target, after) {
  let rec, chunks = [];
  button.onclick = async () => {
    if (rec?.state === "recording") { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream); chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        button.classList.remove("on"); button.textContent = "…";
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: new Blob(chunks, { type: rec.mimeType }) });
          const r = await res.json();
          if (!res.ok) throw new Error(r.error);
          target.value = r.text; after?.();
        } catch (err) { alert(err.message); }
        button.textContent = "Speak";
      };
      rec.start(); button.classList.add("on"); button.textContent = "Stop";
    } catch { button.textContent = "No microphone"; }
  };
}
mic($("#mic"), $("#question"), () => $("#ask-form").requestSubmit());
mic($("#mic-pitch"), $("#pitch"));

async function loadLibrary() {
  const [{ authors }, { sources }] = await Promise.all([api("/api/authors"), api("/api/sources")]);
  const box = $("#jurors"); box.textContent = "";
  if (!authors.length) box.append(el("span", "muted", "The library is empty: ingest some videos or books first."));
  for (const a of authors) {
    const l = el("label"), c = el("input"); c.type = "checkbox"; c.value = a.author;
    c.onchange = () => { if ([...box.querySelectorAll("input:checked")].length > 3) c.checked = false; };
    l.append(c, `${a.author} (${a.sources})`); box.append(l);
  }
  const tb = $("#sources"); tb.textContent = "";
  for (const s of sources) {
    const tr = el("tr"), title = el("td"), link = el("a", null, s.title);
    if (s.url) { link.href = s.url; link.target = "_blank"; link.rel = "noopener"; }
    title.append(link);
    tr.append(el("td", null, s.author), title, el("td", null, s.kind), el("td", null, s.chunks)); tb.append(tr);
  }
}
loadLibrary().catch(err => { $("#jurors").textContent = err.message; });

const badge = v => el("span", `badge ${v === "approve" ? "approve" : v === "reject" ? "reject" : "changes"}`, v);

$("#run-jury").onclick = async () => {
  const jurors = [...document.querySelectorAll("#jurors input:checked")].map(c => c.value);
  if (!jurors.length) { alert("Pick at least one juror"); return; }
  let project; try { project = JSON.parse($("#project").value); } catch { alert("The project is not valid JSON"); return; }
  const btn = $("#run-jury"); btn.disabled = true;
  const out = $("#verdicts"); out.textContent = "The jury is deliberating…";
  try {
    const r = await api("/api/jury", { jurors, project, pitch: $("#pitch").value, lang });
    out.textContent = "";
    if (r.chair) {
      const d = el("div", "verdict"), h = el("h3", null, "Chair");
      h.append(badge(r.chair.verdict)); d.append(h);
      for (const [title, list] of [["Agree", r.chair.agree], ["Differ", r.chair.disagree], ["Next", r.chair.next]]) {
        if (!list?.length) continue;
        d.append(el("strong", null, title)); const ul = el("ul"); list.forEach(x => ul.append(el("li", null, x))); d.append(ul);
      }
      out.append(d);
    }
    for (const j of r.jurors) {
      const d = el("div", "verdict"), h = el("h3", null, j.juror);
      h.append(badge(j.verdict)); d.append(h, el("p", null, j.summary));
      const ul = el("ul");
      for (const reason of j.reasons) ul.append(el("li", null, `${reason.stance === "praise" ? "+" : "−"} ${reason.point} [${reason.passage}]`));
      d.append(ul);
      if (j.passages.length) d.append(citeList(j.passages));
      out.append(d);
    }
  } catch (err) { out.textContent = err.message; }
  btn.disabled = false;
};
