// 성장 MAP — 선생님 자료실 + 학생용 영상 보기
// 교재 목록은 data/site.json, 교재마다 내용은 각자의 json 파일에서 관리합니다.
// 학생용 화면: 주소 끝에 ?view=student (선생님 자료 칸이 숨겨집니다)

const app = document.getElementById("app");
const isStudent = new URLSearchParams(location.search).get("view") === "student";
document.documentElement.dataset.view = isStudent ? "student" : "teacher";

let course = null;
let siteTitle = "";
let units = [];
let courses = [];      // site.json의 교재 목록
let cid = "";          // 지금 보고 있는 교재 id
let defaultId = "";    // 주소에 교재가 없을 때 여는 교재 (예전 주소·QR 호환)
const loaded = {};     // 교재 id → { course, units }

/* ---------- 도구 ---------- */

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}


function safeUrl(url) {
  if (!url || !String(url).trim()) return "";
  try {
    const u = new URL(url, location.href);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch { return ""; }
}

const svg = (path, size = 20) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const icon = {
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  screen: svg('<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
  left: svg('<path d="m15 18-6-6 6-6"/>', 28),
  right: svg('<path d="m9 18 6-6-6-6"/>', 28),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 24),
  arrow: svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 18),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>', 16),
};

function findLesson(unitId, no) {
  const unit = units.find((u) => u.id === unitId);
  const lesson = unit?.lessons.find((l) => String(l.no) === String(no));
  return unit && lesson ? { unit, lesson } : null;
}

function allLessons() {
  return units.flatMap((unit) => unit.lessons.map((lesson) => ({ unit, lesson })));
}

// 차시 대신 "편"처럼 다른 말을 쓰는 교재: course.lessonWord
const LW = () => course?.lessonWord || "차시";
const homeHref = (id = cid) => `#/c/${encodeURIComponent(id)}`;
const lessonHref = (unit, lesson) => `${homeHref()}/lesson/${encodeURIComponent(unit.id)}/${lesson.no}`;
const ytThumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
// 영상은 유튜브(youtubeId) 또는 사이트에 올린 mp4 파일(file, 사이트 안 경로만)
const vidFile = (v) => { const f = String(v?.file ?? "").trim(); return f && !/^[a-z]+:/i.test(f) ? f : ""; };
const hasMedia = (v) => Boolean(String(v?.youtubeId ?? "").trim() || vidFile(v));
const fileVideo = (v, attrs = "") => `<video${attrs} src="${esc(vidFile(v))}"${v.thumb && !/^[a-z]+:/i.test(v.thumb) ? ` poster="${esc(v.thumb)}"` : ""} controls playsinline preload="metadata" title="${esc(v.title || "수업 영상")}"></video>`;

function teacherFileCount(lesson) {
  const t = lesson.teacher ?? {};
  return [t.worksheet].filter(Boolean).length;
}

/* ---------- 배지 모으기 (학생용 화면만) ----------
   차시의 "배지 영상"을 실제로 70% 이상 보면 그 차시 배지를 얻음 (학생에게 기준은 알리지 않음).
   배지 영상: "short": true 표시한 숏츠가 있으면 그 영상, 없으면 그 차시의 영상 아무거나.
   기록은 이 기기 브라우저(localStorage)에만 남고, 이름·로그인은 쓰지 않음. */
const BADGE_KEY = "snja-badges-v1";
function readEarned() {
  try { return JSON.parse(localStorage.getItem(BADGE_KEY) || "{}") || {}; } catch { return {}; }
}
function writeEarned(map) {
  try { localStorage.setItem(BADGE_KEY, JSON.stringify(map)); return true; } catch { return false; }
}
const badgeKey = (courseId, unit, lesson) => `${courseId}/${unit.id}/${lesson.no}`;
const isEarned = (courseId, unit, lesson) => Boolean(readEarned()[badgeKey(courseId, unit, lesson)]);
function badgeVideoIndexes(lesson) {
  const vids = lesson.videos ?? [];
  const ok = vids.map((v, k) => (hasMedia(v) ? k : -1)).filter((k) => k >= 0);
  const shorts = ok.filter((k) => vids[k].short);
  return shorts.length ? shorts : ok;
}

// 차시 배지 (지도안의 휴먼스킬아트 배지 퀘스트 이미지)
function badgeImg(lesson, cls) {
  const src = String(lesson.badge ?? "").trim();
  if (!src || /^[a-z]+:/i.test(src)) return "";
  return `<img class="${cls}" src="${esc(src)}" alt="${lesson.no}${LW()} ${esc(lesson.title)} 배지 (Google Gemini로 생성한 이미지)" title="Google Gemini로 생성한 이미지" width="120" height="136" loading="lazy">`;
}

function lessonStatus(lesson) {
  const v = lesson.videos?.length ?? 0;
  const f = teacherFileCount(lesson);
  const parts = [];
  const np = (lesson.videos ?? []).reduce((n, x) => n + (x.parts?.length ?? 0), 0);
  if (np) parts.push(`파트 ${np}개`);
  else if (v) parts.push(`영상 ${v}개`);
  if (f && !isStudent) parts.push(`자료 ${f}개`);
  return parts.length ? parts.join(", ") : "준비 중";
}


/* ---------- 첫 화면 ---------- */

// 선생님 자료 목록 ("누구나 예술가가 될 수 있다"처럼 차시가 없는 교재)
function renderResources() {
  const list = course.resources ?? [];
  const groups = course.groups ?? [];
  const intro = `
    <section class="intro">
      <h1 class="course-title">${esc(course.title)}</h1>
      ${course.tagline ? `<p class="lede">${esc(course.tagline)}</p>` : ""}
    </section>`;
  // 교재 묶음이 있으면: 왼쪽(제목·교재 탭) | 오른쪽(차시 목록) 두 칸
  app.innerHTML = groups.length
    ? (() => { const [chips, sections] = groupedResources(list, groups);
        return `<div class="demo-layout"><aside class="demo-side">${intro}${chips}</aside><div class="demo-main">${sections}</div></div>`; })()
    : `<div class="home-layout"><aside class="home-side">${intro}</aside><div class="home-main"><ul class="resources">${list.map((r) => resourceItem(r)).join("")}</ul></div></div>`;
  app.querySelectorAll(".group-chips button").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.g;
    app.querySelectorAll(".group-chips button").forEach((x) => { x.setAttribute("aria-pressed", String(x === b)); x.setAttribute("aria-selected", String(x === b)); });
    app.querySelectorAll(".res-group").forEach((sec) => { sec.hidden = sec.dataset.g !== g; });
    try { localStorage.setItem("demoGroup", g); } catch {}
  }));
  app.querySelectorAll("[data-ppt]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    // 수업 시연: 모든 교재의 PPT 줄을 차례대로 묶어서, 보기 화면에서 이전·다음 차시로 바로 넘김
    const all = [...app.querySelectorAll(".demo-main [data-ppt]")];
    // r.videos: PPT 화면에 나오는 영상 [{title, youtubeId | file, start, slide}]
    const vmap = new Map((course.resources ?? []).filter((r) => r.ppt).map((r) => [safeUrl(r.ppt), r.videos ?? []]));
    const list = (all.length ? all : [a]).map((el) => {
      const row = el.closest(".ri");
      const no = row?.querySelector(".ri-no")?.textContent.trim() ?? "";
      const t = row?.querySelector(".ri-title")?.textContent.trim() || el.dataset.title || "";
      const g = el.closest(".res-group");
      return { src: el.dataset.ppt, title: no ? `${no} · ${t}` : t, group: g?.querySelector("h2")?.textContent.trim() ?? "", g: g?.dataset.g,
        videos: vmap.get(el.dataset.ppt) ?? [] };
    });
    openDeck(list, Math.max(0, all.indexOf(a)));
  }));
  document.title = `${course.title} · ${siteTitle}`;
  fitTitle();
  window.scrollTo(0, 0);
  if (groups.length) fillLessonTitles(groups);
}

// 수업 시연 줄 이름을 각 교재의 차시 제목으로 채움 (못 불러오면 원래 이름 그대로)
async function fillLessonTitles(groups) {
  await Promise.all(groups.map(async (g, i) => {
    const entry = courses.find((x) => x.id === g.course);
    if (!entry) return;
    try {
      if (!loaded[entry.id]) {
        const data = await (await fetch(entry.file, { cache: "no-cache" })).json();
        loaded[entry.id] = { course: data.course, units: data.units ?? [] };
      }
      const lessons = loaded[entry.id].units.flatMap((u) => u.lessons ?? []);
      app.querySelectorAll(`.res-group[data-g="${i}"] .ri`).forEach((li, k) => {
        const l = lessons.find((x) => Number(x.no) === k + 1) ?? lessons[k];
        const t = li.querySelector(".ri-title");
        if (l?.title && t) { t.title = t.textContent; t.textContent = l.title; }
      });
    } catch { /* 이름은 원래대로 둠 */ }
  }));
}

// 자료 한 줄 (수업 시연 등)
function resourceItem(r, prefixes = []) {
  const src = String(r.source ?? "");
  const pre = prefixes.filter(Boolean).find((x) => src.startsWith(x));
        const url = safeUrl(r.url);
        // r.links: 오른쪽에 붙는 작은 버튼들 [{label, url, download}] (예: PDF, PPT 받기)
        const extra = (r.links ?? (r.download ? [{ label: r.downloadLabel || "원본 받기", url: r.download, download: true }] : []))
          .map((x) => ({ ...x, url: safeUrl(x.url) })).filter((x) => x.url);
        const dl = extra.length;
        // r.ppt: 누르면 사이트 안에서 PPT 그대로 보기 (새 창 X)
        const pdf = safeUrl(r.ppt);
        const open = pdf ? `<a class="resource" href="${esc(pdf)}" data-ppt="${esc(pdf)}" data-title="${esc(r.title)}">`
          : url ? `<a class="resource" href="${esc(url)}" target="_blank" rel="noopener">` : `<span class="resource is-empty">`;
        return `<li${dl ? ` class="has-dl"` : ""}>${open}
          <span class="resource-title">${esc(r.title)}</span>
          <span class="resource-meta">${[r.author, pre ? src.slice(pre.length).trim() : r.source].filter(Boolean).map(esc).join(" · ")}</span>
          ${pdf ? `${icon.screen}</a>` : url ? `${icon.external}</a>` : `</span>`}${extra.map((x) => `<a class="resource-dl" href="${esc(x.url)}" ${x.download ? "download" : `target="_blank" rel="noopener"`}>${esc(x.label)}</a>`).join("")}</li>`;
      }

// course.groups: 교재별 탭(연한 색)으로 나누고, 차시 줄을 누르면 바로 PPT 보기
// [{ title, short, course, author, from, to, tone }]  (from~to: 자료 번호, 1부터)
function groupedResources(list, groups) {
  const ready = (g) => list.slice(g.from - 1, g.to).filter((r) => safeUrl(r.url)).length;
  let cur = 0;
  try { const v = Number(localStorage.getItem("demoGroup")); if (v >= 0 && v < groups.length) cur = v; } catch {}
  const chips = `<div class="group-chips" role="tablist" aria-label="교재 고르기">
      ${groups.map((g, i) => `<button type="button" role="tab" class="tone-${esc(g.tone || "")}" data-g="${i}" aria-selected="${i === cur}" aria-pressed="${i === cur}">${esc(g.short || g.title)}</button>`).join("")}
    </div>`;
  const row = (r, k, g) => {
    const pdf = safeUrl(r.ppt), url = safeUrl(r.url);
    const extra = (r.links ?? []).map((x) => ({ ...x, url: safeUrl(x.url) })).filter((x) => x.url);
    const no = `<span class="ri-no">${k + 1}${LW()}</span>`;
    if (!pdf && !url) return `<li class="ri is-empty"><div class="ri-head">${no}<span class="ri-title">${esc(r.title)}</span><span class="ri-soon">준비 중</span></div></li>`;
    // 줄(제목)을 누르면 바로 PPT 보기, 오른쪽 작은 버튼은 PDF·PPT 받기
    const open = pdf ? `<a class="ri-head" href="${esc(pdf)}" data-ppt="${esc(pdf)}" data-title="${esc(r.title)}">`
      : `<a class="ri-head" href="${esc(url)}" target="_blank" rel="noopener">`;
    return `<li class="ri">${open}${no}<span class="ri-title">${esc(r.title)}</span><span class="ri-go">${pdf ? icon.screen : icon.external}</span></a>
      ${extra.map((x) => `<a class="ri-btn" href="${esc(x.url)}" ${x.download ? "download" : `target="_blank" rel="noopener"`}>${esc(x.label)}</a>`).join("")}</li>`;
  };
  const sections = groups.map((g, i) => `
    <section class="res-group tone-${esc(g.tone || "")}" data-g="${i}" role="tabpanel" aria-labelledby="rg-${i}"${i === cur ? "" : " hidden"}>
      <header class="res-group-head">
        <h2 id="rg-${i}">${esc(g.title)}</h2>
        <p>${g.from}~${g.to}${LW()}${g.author ? ` · ${esc(g.author)}` : ""} · 준비 ${ready(g)}/${g.to - g.from + 1}
          ${g.course ? ` · <a href="${homeHref(g.course)}">교재 보기</a>` : ""}</p>
      </header>
      <ul class="ri-list">${list.slice(g.from - 1, g.to).map((r, k) => row(r, k, i)).join("")}</ul>
    </section>`).join("");
  return [chips, sections];
}

// ── 사이트 안 PPT 보기: Microsoft Office 온라인 뷰어(무료, 로그인 없음)를 화면 안에 띄움 ──
// list: [{ src, title, group, g }] — 보기 화면 위쪽 버튼으로 이전·다음 차시 PPT로 바로 넘어감
function openDeck(list, start = 0) {
  if (!Array.isArray(list)) list = [{ src: list, title: arguments[1] }];
  let i = start;
  const box = document.createElement("div");
  box.className = "pdfv";
  box.innerHTML = `
    <div class="pdfv-bar">
      <button class="pdfv-btn pdfv-nav" data-act="prev" aria-label="이전 차시">◀<span> 이전</span></button>
      <div class="pdfv-head"><small class="pdfv-group"></small><b class="pdfv-title"></b></div>
      <span class="pdfv-count" aria-live="polite"></span>
      <button class="pdfv-btn pdfv-nav" data-act="next" aria-label="다음 차시"><span>다음 </span>▶</button>
      <button class="pdfv-btn pdfv-vbtn" data-act="vids" aria-expanded="false" aria-controls="pdfv-vlist">영상</button>
      <a class="pdfv-btn pdfv-dl" download>PPT 받기</a>
      <button class="pdfv-btn" data-act="full">전체 화면</button>
      <button class="pdfv-btn" data-act="close">닫기 ✕</button>
    </div>
    <div class="pdfv-body">
      <iframe class="pdfv-frame" allowfullscreen></iframe>
      <div class="pdfv-vlist" id="pdfv-vlist" hidden></div>
      <div class="pdfv-player" hidden>
        <div class="pdfv-pbar"><b class="pdfv-ptitle"></b><button class="pdfv-btn" data-act="vclose">PPT로 돌아가기 ✕</button></div>
        <div class="pdfv-pbox"></div>
      </div>
    </div>`;
  const frame = box.querySelector(".pdfv-frame");
  const vbtn = box.querySelector(".pdfv-vbtn"), vlist = box.querySelector(".pdfv-vlist");
  const player = box.querySelector(".pdfv-player"), pbox = box.querySelector(".pdfv-pbox");
  // PPT에 나오는 영상: 목록을 펼쳐 고르면 PPT 위에 크게 재생, 닫으면 보던 PPT로 돌아감
  const vids = () => list[i].videos ?? [];
  const toggleList = (open = vlist.hidden) => { vlist.hidden = !open; vbtn.setAttribute("aria-expanded", String(open)); };
  const play = (v) => {
    const id = String(v.youtubeId ?? "").replace(/[^A-Za-z0-9_-]/g, "");
    const file = v.file && !/^[a-z]+:/i.test(v.file) ? v.file : "";
    if (!id && !file) return;
    pbox.innerHTML = id
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${v.start ? `&start=${Number(v.start) || 0}` : ""}" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
      : `<video src="${esc(file)}" controls autoplay playsinline title="${esc(v.title)}"></video>`;
    box.querySelector(".pdfv-ptitle").textContent = v.title;
    player.hidden = false; toggleList(false);
  };
  const stop = () => { pbox.innerHTML = ""; player.hidden = true; };
  const show = () => {
    const d = list[i];
    const abs = new URL(d.src, location.href).href;
    frame.src = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(abs)}`;
    frame.title = d.title || "PPT";
    box.querySelector(".pdfv-title").textContent = d.title || "";
    box.querySelector(".pdfv-group").textContent = d.group || "";
    box.querySelector(".pdfv-dl").href = d.src;
    box.querySelector(".pdfv-count").textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
    box.querySelector('[data-act="prev"]').disabled = i === 0;
    box.querySelector('[data-act="next"]').disabled = i === list.length - 1;
    box.querySelectorAll(".pdfv-nav").forEach((b) => { b.hidden = list.length < 2; });
    stop(); toggleList(false);
    const vs = vids();
    vbtn.hidden = !vs.length;
    vbtn.textContent = vs.length > 1 ? `▶ 영상 ${vs.length}` : "▶ 영상";
    vlist.innerHTML = vs.map((v, k) => `<button type="button" data-v="${k}">${v.slide ? `<small>${Number(v.slide)}쪽</small>` : ""}<span>${esc(v.title)}</span></button>`).join("");
  };
  const go = (d) => { const n = i + d; if (n < 0 || n >= list.length) return; i = n; show(); };
  document.body.appendChild(box);
  document.body.style.overflow = "hidden";
  show();
  const close = () => {
    document.removeEventListener("keydown", key);
    if (document.fullscreenElement) document.exitFullscreen?.();
    box.remove(); document.body.style.overflow = "";
    // 마지막으로 본 차시의 교재 탭을 열어 둠
    const g = list[i]?.g;
    if (g != null) app.querySelector(`.group-chips button[data-g="${g}"]`)?.click();
  };
  // 키보드: Esc 닫기, PageUp/PageDown 이전·다음 차시 (화살표는 슬라이드 넘기기에 씀)
  const key = (e) => {
    if (e.key === "Escape") { if (!player.hidden) stop(); else if (!vlist.hidden) toggleList(false); else close(); }
    else if (e.key === "PageDown") { e.preventDefault(); go(1); }
    else if (e.key === "PageUp") { e.preventDefault(); go(-1); }
  };
  document.addEventListener("keydown", key);
  box.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const vb = e.target.closest("[data-v]");
    if (vb) { play(vids()[Number(vb.dataset.v)]); return; }
    if (act === "vids") { vids().length === 1 ? play(vids()[0]) : toggleList(); return; }
    if (act === "vclose") { stop(); return; }
    if (!e.target.closest(".pdfv-vlist")) toggleList(false);
    if (act === "close") close();
    else if (act === "prev") go(-1);
    else if (act === "next") go(1);
    else if (act === "full") (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.())?.catch?.(() => {});
  });
}

function renderHome() {
  if (course.resources && !units.length) return renderResources();
  const multiUnit = units.length > 1;

  const unitBlocks = units.map((unit) => `
    <section class="unit">
      ${multiUnit ? `<h2 class="unit-title">${esc(unit.title)}</h2>` : ""}
      <ol class="sequence">
        ${unit.lessons.map((lesson) => {
          const ready = (lesson.videos?.length ?? 0) + (isStudent ? 0 : teacherFileCount(lesson)) > 0;
          const vids = (lesson.videos ?? [])
            .map((v, k) => ({ id: String(v.youtubeId ?? "").trim(), file: vidFile(v), title: v.title || `영상 ${k + 1}`, k, thumb: v.thumb }))
            .filter((v) => v.id || (v.file && v.thumb));
          // video.thumb: 유튜브 자동 썸네일 대신 쓸 그림 (교재 안에서 썸네일을 통일할 때, mp4 파일 영상은 꼭 적기)
          const thumbOf = (v) => (v.thumb && !/^[a-z]+:/i.test(v.thumb) ? esc(v.thumb) : ytThumb(v.id));
          const thumbId = vids[0]?.id || vids[0]?.file;
          // 차시 줄 오른쪽에 영상 썸네일 띠. 누르면 그 차시 화면에서 해당 영상으로 바로 감
          const strip = vids.length ? `
            <ul class="step-videos" aria-label="${lesson.no}${LW()} 영상">
              ${vids.map((v) => `<li><a href="${lessonHref(unit, lesson)}/v${v.k + 1}">
                <img src="${thumbOf(v)}" alt="" loading="lazy" width="320" height="180">
                <span><b>${v.k + 1}</b>${esc(v.title)}</span></a></li>`).join("")}
            </ul>` : "";
          const earned = isStudent && isEarned(cid, unit, lesson);
          return `
          <li class="${ready ? "is-ready" : "is-empty"}${vids.length ? " has-videos" : ""}${vids.length === 1 ? " one-video" : ""}${isStudent ? (earned ? " is-earned" : " not-earned") : ""}">
            <a class="step" href="${lessonHref(unit, lesson)}">
              ${badgeImg(lesson, "step-badge") || `<span class="step-no">${lesson.no}</span>`}
              <span class="step-text">
                <span class="step-title" title="${esc(lesson.title)}">${esc(lesson.title)}</span>
                ${lesson.topic ? `<span class="step-topic">${esc(lesson.topic)}</span>` : ""}
                <span class="step-status">${esc(lessonStatus(lesson))}</span>
              </span>
              ${thumbId ? `<img class="step-thumb" src="${thumbOf(vids[0])}" alt="" loading="lazy">` : ""}
            </a>${strip}
          </li>`;
        }).join("")}
      </ol>
    </section>`).join("");

  const lessonCount = allLessons().length;

  // PC: 왼쪽(교재 제목·안내) | 오른쪽(차시 카드 여러 칸) — 스크롤 없이 한 화면에
  app.innerHTML = `<div class="home-layout"><aside class="home-side">
    <section class="intro">
      <h1 class="course-title">${esc(course.title)}</h1>
      ${course.tagline ? `<p class="lede">${esc(course.tagline)}</p>` : ""}
      <p class="intro-note">${[course.grade, course.subject].filter(Boolean).map(esc).join(" ")}${course.grade || course.subject ? ", " : ""}${lessonCount}${LW()}${course.author ? ` · ${esc(course.author)}` : ""}.
        ${isStudent
          ? `${LW()}${LW() === "편" ? "을" : "를"} 골라 수업 영상을 다시 볼 수 있어요.`
          : (course.noWorksheet ? `${LW()}마다 수업 영상을 파트별로 보며 활동할 수 있습니다.` : `${LW()}마다 수업 영상을 보고 활동지를 무료로 받을 수 있습니다.`)}</p>
      ${isStudent ? "" : `<a class="text-link" href="${homeHref()}/qr">학생용 QR 코드 보기</a>`}
      ${isStudent ? "" : (course.teacherLinks ?? []).map((l) => safeUrl(l.url)
        ? `<a class="text-link teacher-link" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.title)}</a>` : "").join("")}
    </section></aside>
    <div class="home-main${lessonCount <= 4 ? " is-few" : ""}">${unitBlocks}</div></div>`;
  document.title = `${course.title} · ${siteTitle}`;
  fitTitle();
  document.fonts?.ready.then(fitTitle);
}

// 교재 제목을 줄바꿈 없이 한 줄에 맞춤. 너무 작아지면(휴대폰의 긴 제목) 그때만 줄바꿈
function fitTitle() {
  const h = document.querySelector(".intro h1");
  if (!h) return;
  h.style.fontSize = "";
  h.classList.remove("is-wrap");
  // PC 두 칸 화면의 왼쪽 제목은 CSS가 크기·줄바꿈을 맡음
  if (h.closest(".home-side") && matchMedia("(min-width: 1024px)").matches) {
    // 긴 제목은 작게 시작하고, 낱말 중간에서 끊지 않게 가장 긴 낱말이 칸에 들어갈 때까지 줄임
    h.classList.toggle("is-long", h.textContent.trim().length > 14);
    let size = parseFloat(getComputedStyle(h).fontSize);
    while (h.scrollWidth > h.clientWidth + 1 && size > 20) { size -= 2; h.style.fontSize = `${size}px`; }
    return;
  }
  const base = parseFloat(getComputedStyle(h).fontSize);
  const room = h.clientWidth;
  if (h.scrollWidth <= room) return;
  const size = Math.floor(base * room / h.scrollWidth * 0.98);
  if (size >= 16) h.style.fontSize = `${size}px`;
  else { h.style.fontSize = "16px"; h.classList.add("is-wrap"); }
}
window.addEventListener("resize", () => requestAnimationFrame(fitTitle));

/* ---------- 차시 화면 ---------- */

function videoBlock(video, index, total, play = false, track = false) {
  const id = String(video.youtubeId ?? "").trim();
  const player = id
    ? `<iframe${track ? ` data-badge-video` : ""} src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0${play ? "&autoplay=1" : ""}${track ? `&enablejsapi=1&origin=${encodeURIComponent(location.origin)}` : ""}"
         title="${esc(video.title || "수업 영상")}"${play ? "" : ` loading="lazy"`} allowfullscreen
         allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"></iframe>`
    : vidFile(video)
      ? fileVideo(video, `${track ? " data-badge-video" : ""}${play ? " autoplay" : ""}`)
      : `<div class="player-empty">영상 준비 중</div>`;

  const sourceUrl = safeUrl(video.url);
  const credit = video.external
    ? `<p class="credit">출처: ${esc(video.channel || "외부 영상")}${sourceUrl
        ? ` · <a href="${esc(sourceUrl)}" target="_blank" rel="noopener">원본 보기 ${icon.external}</a>` : ""}</p>`
    : "";

  const caption = total > 1 || video.title
    ? `<p class="video-title">${total > 1 ? `<span>영상 ${index + 1}</span>` : ""}${esc(video.title || "")}</p>`
    : "";

  return `<figure class="video${video.short ? " is-short" : ""}${play ? " is-picked" : ""}" id="video-${index + 1}"><div class="player">${player}</div>${caption}${credit}</figure>`;
}

// 차시 작가 소개 (lesson.artist): 학생·선생님 화면 모두
function artistSection(lesson) {
  const a = lesson.artist;
  if (!a) return "";
  const links = (a.links ?? []).map((l) => safeUrl(l.url) ? `<a class="part-link" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${icon.external}<span><b>${esc(l.title)}</b></span></a>` : "").join("");
  return `
    <section class="artist-card" aria-labelledby="artist-h">
      <p class="artist-kicker">이 ${LW()}의 작가</p>
      <h2 id="artist-h">${esc(a.name)}${a.life ? ` <small>${esc(a.life)}</small>` : ""}</h2>
      ${(a.intro ?? []).map((t) => `<p>${esc(t)}</p>`).join("")}
      ${a.work ? `<p class="artist-work"><span>대표 작업</span>${esc(a.work)}</p>` : ""}
      ${a.ask ? `<p class="artist-ask">${esc(a.ask)}</p>` : ""}
      ${links ? `<div class="artist-links">${links}</div>` : ""}
    </section>`;
}

function listSection(title, items, ordered = false) {
  if (!items?.length) return "";
  const tag = ordered ? "ol" : "ul";
  return `<section class="detail"><h2>${title}</h2><${tag}>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</${tag}></section>`;
}

function teacherSection(lesson) {
  if (isStudent) return "";
  const t = lesson.teacher ?? {};
  // course.noWorksheet: 활동지가 없는 교재는 활동지 칸을 보여 주지 않음
  const files = course.noWorksheet ? [] : [
    { label: "수업 활동지", url: t.worksheet },
  ];
  const items = files.map((f) => {
    const url = safeUrl(f.url);
    // 사이트 안에 올린 파일은 "휴먼스킬아트_1차시_수업 활동지.hwpx" 같은 이름으로 내려받게 함
    const local = url && !/^https?:/i.test(String(f.url).trim());
    const ext = local ? (String(f.url).match(/\.[a-z0-9]+$/i)?.[0] ?? "") : "";
    const dl = local ? ` download="${esc(`${course.title}_${lesson.no}${LW()}_${f.label}${ext}`)}"` : "";
    return url
      ? `<li><a class="file" href="${esc(url)}"${dl} target="_blank" rel="noopener">${icon.download}<span>${f.label}</span><span class="format">받기</span></a></li>`
      : `<li><span class="file is-empty" aria-disabled="true">${icon.download}<span>${f.label}</span><span class="format">준비 중</span></span></li>`;
  }).join("");

  // 수업 지도안·PPT는 이 사이트에 올리지 않고 경기형 AI 교수·학습 플랫폼으로 안내
  const m = course.materials ?? {};
  const mUrl = safeUrl(m.url);
  const platform = mUrl
    ? `<li><a class="file" href="${esc(mUrl)}" target="_blank" rel="noopener">${icon.external}<span>${esc(m.label || "수업 지도안·PPT")}</span><span class="format">외부 사이트</span></a></li>`
    : "";
  const note = mUrl
    ? `<p class="files-note">${esc(m.label || "수업 지도안·PPT")}는 <a href="${esc(mUrl)}" target="_blank" rel="noopener">${esc(m.source || "외부 사이트")}</a>에서 받을 수 있어요.</p>`
    : "";

  if (!items && !platform && !course.license) return "";
  return `
    <section class="teacher">
      <h2>선생님 자료</h2>
      <ul class="files">${items}${platform}</ul>
      ${note}
      ${course.license ? `<p class="license">${esc(course.license.summary)}
        <a href="${esc(course.license.url)}" target="_blank" rel="noopener">${esc(course.license.name)}</a></p>` : ""}
    </section>`;
}

function renderLesson(unitId, no, pick = 0) {
  const found = findLesson(unitId, no);
  if (!found) {
    app.innerHTML = `<p class="status">차시를 찾을 수 없어요. <a href="${homeHref()}">처음으로</a></p>`;
    return;
  }
  const { unit, lesson } = found;
  const list = allLessons();
  const i = list.findIndex((x) => x.lesson === lesson);
  const prev = list[i - 1];
  const next = list[i + 1];

  // 학생용 화면에서 아직 못 얻은 배지면 배지 영상을 지켜봄
  const track = isStudent && lesson.badge && !isEarned(cid, unit, lesson) ? badgeVideoIndexes(lesson) : [];
  const videos = lesson.videos?.length
    ? lesson.videos.map((v, k) => v.parts?.length
        ? partsBlock(v, k)
        : videoBlock(v, k, lesson.videos.length, k + 1 === pick, track.includes(k))).join("")
    : "";

  const details = [
    listSection("준비물", lesson.materials),
    listSection("활동 순서", lesson.steps, true),
    isStudent ? "" : listSection("생각해 볼 질문", lesson.questions),
  ].join("");

  const canClassMode = !isStudent && (lesson.videos?.length || lesson.steps?.length);

  app.innerHTML = `
    <nav class="crumb"><a href="${homeHref()}">${esc(course.title)}</a>${units.length > 1 ? ` <span>/</span> ${esc(unit.title)}` : ""}</nav>
    <header class="lesson-head">
      <div class="lesson-title${isStudent && lesson.badge && !isEarned(cid, unit, lesson) ? " not-earned" : ""}">
        ${badgeImg(lesson, "lesson-badge")}
        <div>
          <p class="lesson-kicker">${lesson.no}${LW()}</p>
          <h1>${esc(lesson.title)}</h1>
          ${lesson.topic ? `<p class="lesson-topic">${esc(lesson.topic)}</p>` : ""}
          ${badgeNote(unit, lesson)}
        </div>
      </div>
      ${lesson.goal ? `<p class="goal"><span>학습 목표</span>${esc(lesson.goal)}</p>` : ""}
      ${canClassMode ? `<button class="btn-primary" id="class-mode" type="button">${icon.screen}수업 모드</button>` : ""}
    </header>

    ${videos ? `<div class="videos">${videos}</div>` : `<p class="empty-note">수업 영상은 준비 중입니다.</p>`}

    ${artistSection(lesson)}

    ${details
      ? `<div class="details">${details}</div>`
      : `<p class="empty-note">이 ${LW()}의 활동 안내는 준비 중입니다.</p>`}

    ${notesSection(unit, lesson)}

    ${teacherSection(lesson)}

    <nav class="pager">
      ${prev ? `<a href="${lessonHref(prev.unit, prev.lesson)}"><span>이전 ${LW()}</span>${esc(prev.lesson.title)}</a>` : "<span></span>"}
      ${next ? `<a class="next" href="${lessonHref(next.unit, next.lesson)}"><span>다음 ${LW()}</span>${esc(next.lesson.title)}</a>` : ""}
    </nav>`;

  document.getElementById("class-mode")?.addEventListener("click", () => openClassMode(lesson));
  document.title = `${lesson.no}${LW()} ${lesson.title} · ${course.title}`;
  if (track.length) watchBadgeVideos(unit, lesson);
  bindNotes(unit, lesson);
  (lesson.videos ?? []).forEach((v, k) => { if (v.parts?.length) bindParts(unit, lesson, v, k); });
  const picked = pick ? document.getElementById(`video-${pick}`) : null;
  if (picked) picked.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
}

/* ---------- 파트별로 보고 활동하기 ----------
   영상 하나를 파트(start~end 초)로 나눠, 파트를 누르면 그 구간만 재생하고 끝나면 멈춘 뒤 활동을 보여 줌.
   video.parts: [{ title, start, end, summary, links: [{title, channel, url}], activity: [...] }]
   activity 종류: { type: "write", prompts: [] } · { type: "quiz", q, options: [], answer, explain } · { type: "check", items: [] }
   학생이 쓴 내용·체크·본 파트는 이 기기 브라우저에만 저장됨. */
const PARTS_KEY = "snja-parts-v1";
const readParts = () => { try { return JSON.parse(localStorage.getItem(PARTS_KEY) || "{}") || {}; } catch { return {}; } };
const writeParts = (m) => { try { localStorage.setItem(PARTS_KEY, JSON.stringify(m)); } catch { /* 저장 못 해도 활동은 됨 */ } };
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function partsBlock(video, k) {
  const id = String(video.youtubeId ?? "").trim();
  const file = String(video.file ?? "").trim();
  const player = id || file ? `<div class="player" data-part-player></div>` : `<div class="player"><div class="player-empty">영상 준비 중 · 아래 파트 활동은 지금 할 수 있어요</div></div>`;
  return `
    <section class="parts" id="video-${k + 1}" data-v="${k}">
      <div class="parts-stage">
        <figure class="video">${player}
          ${video.title ? `<p class="video-title">${esc(video.title)}</p>` : ""}</figure>
        <ol class="part-list" aria-label="영상 파트">
          ${video.parts.map((p, i) => `<li><button type="button" class="part-btn" data-p="${i}">
            <span class="part-no">${i + 1}</span>
            <span class="part-name">${esc(p.title)}</span>
            <span class="part-time">${fmtTime(p.end - p.start)}</span>
            <span class="part-done" aria-hidden="true">✓</span></button></li>`).join("")}
        </ol>
      </div>
      <div class="part-panel" aria-live="polite"></div>
    </section>`;
}

function activityHtml(a, j, st) {
  if (a.type === "write") {
    return `<div class="act act-write">${a.prompts.map((q, n) => `
      <label class="act-q" for="w-${j}-${n}">${esc(q)}</label>
      <textarea id="w-${j}-${n}" data-w="${j}-${n}" rows="2" placeholder="내 생각을 써 보세요.">${esc(st.w?.[`${j}-${n}`] ?? "")}</textarea>`).join("")}</div>`;
  }
  if (a.type === "quiz") {
    const picked = st.q?.[j];
    return `<fieldset class="act act-quiz"><legend class="act-q">${esc(a.q)}</legend>
      ${a.options.map((o, n) => `<button type="button" class="quiz-opt${picked === n ? (n === a.answer ? " is-right" : " is-wrong") : ""}" data-q="${j}" data-o="${n}">${esc(o)}</button>`).join("")}
      <p class="quiz-explain"${picked === undefined ? " hidden" : ""}>${picked === a.answer ? "정답이에요! " : picked === undefined ? "" : "다시 생각해 봐요. "}${picked === a.answer ? esc(a.explain || "") : ""}</p></fieldset>`;
  }
  if (a.type === "check") {
    return `<ul class="act act-check">${a.items.map((t, n) => `<li><label>
      <input type="checkbox" data-c="${j}-${n}"${st.c?.[`${j}-${n}`] ? " checked" : ""}><span>${esc(t)}</span></label></li>`).join("")}</ul>`;
  }
  return "";
}

function bindParts(unit, lesson, video, k) {
  const root = document.querySelector(`.parts[data-v="${k}"]`);
  if (!root) return;
  const key = `${badgeKey(cid, unit, lesson)}/v${k}`;
  const parts = video.parts;
  const state = () => readParts()[key] ?? {};
  const save = (fn) => { const all = readParts(); all[key] = all[key] ?? {}; fn(all[key]); writeParts(all); };
  let cur = -1, stopAt = null, ctl = null;

  // 재생기: 유튜브(youtubeId) 또는 mp4 파일(file)
  const mount = root.querySelector("[data-part-player]");
  const id = String(video.youtubeId ?? "").trim();
  let ready = Promise.resolve(null);
  if (mount && id) {
    const el = document.createElement("div"); mount.appendChild(el);
    ready = loadYT().then((YT) => new Promise((resolve) => {
      const p = new YT.Player(el, { videoId: id, host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, playsinline: 1 }, events: { onReady: () => resolve({
          seek: (t) => p.seekTo(t, true), play: () => p.playVideo(), pause: () => p.pauseVideo(),
          time: () => p.getCurrentTime?.() ?? 0 }) } });
    })).catch(() => null);
  } else if (mount && video.file) {
    const v = document.createElement("video");
    v.src = video.file; v.controls = true; v.playsInline = true; v.preload = "metadata";
    mount.appendChild(v);
    ready = Promise.resolve({ seek: (t) => { v.currentTime = t; }, play: () => v.play().catch(() => {}), pause: () => v.pause(), time: () => v.currentTime });
  }
  ready.then((c) => { ctl = c; });

  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); ctl?.pause(); return; }
    if (!ctl || stopAt === null) return;
    if (ctl.time() >= stopAt - 0.15) {
      ctl.pause(); stopAt = null;
      save((s) => { s.done = s.done ?? {}; s.done[cur] = true; });
      paintList();
      root.querySelector(".part-panel")?.classList.add("is-flash");
      setTimeout(() => root.querySelector(".part-panel")?.classList.remove("is-flash"), 1200);
    }
  }, 250);

  function paintList() {
    const done = state().done ?? {};
    root.querySelectorAll(".part-btn").forEach((b) => {
      const i = Number(b.dataset.p);
      b.setAttribute("aria-current", String(i === cur));
      b.classList.toggle("is-done", Boolean(done[i]));
    });
  }

  function show(i, play) {
    cur = i;
    const p = parts[i];
    const st = state();
    // 선생님 화면에서는 teacherUrl(선생님용 주소)이 있으면 그쪽으로 보냄
    const links = (p.links ?? []).map((l) => {
      const t = !isStudent && l.teacherUrl;
      const u = safeUrl(t ? l.teacherUrl : l.url);
      const title = t ? (l.teacherTitle || l.title) : l.title;
      return u ? `<li><a class="part-link" href="${esc(u)}" target="_blank" rel="noopener">${icon.external}<span><b>${esc(title)}</b>${!t && l.channel ? `<small>${esc(l.channel)}</small>` : ""}</span></a></li>` : "";
    }).join("");
    const acts = (p.activity ?? []).map((a, j) => activityHtml(a, j, st)).join("");
    root.querySelector(".part-panel").innerHTML = `
      <p class="part-kicker">파트 ${i + 1} · ${fmtTime(p.start)}~${fmtTime(p.end)}</p>
      <h2 class="part-title">${esc(p.title)}</h2>
      ${p.summary ? `<p class="part-summary">${esc(p.summary)}</p>` : ""}
      ${links ? `<div class="part-links"><h3>영상 속 자료 보기</h3><ul>${links}</ul></div>` : ""}
      ${acts ? `<div class="part-acts"><h3>활동</h3>${acts}</div>` : ""}
      <div class="part-nav">
        <button type="button" class="btn-ghost" data-replay>${icon.screen}이 파트 다시 보기</button>
        ${i + 1 < parts.length ? `<button type="button" class="btn-primary" data-next>다음 파트: ${esc(parts[i + 1].title)} ${icon.arrow}</button>` : ""}
      </div>`;
    paintList();
    if (play && ctl) { ctl.seek(p.start); ctl.play(); stopAt = p.end; }
    else if (play) ready.then((c) => { if (c && cur === i) { c.seek(p.start); c.play(); stopAt = p.end; } });
  }

  root.querySelector(".part-list").addEventListener("click", (e) => {
    const b = e.target.closest(".part-btn"); if (!b) return;
    show(Number(b.dataset.p), true);
    root.querySelector(".parts-stage")?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  const panel = root.querySelector(".part-panel");
  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-next]")) { show(cur + 1, true); root.querySelector(".parts-stage")?.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (e.target.closest("[data-replay]")) { show(cur, true); root.querySelector(".parts-stage")?.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    const o = e.target.closest(".quiz-opt");
    if (o) { save((s) => { s.q = s.q ?? {}; s.q[o.dataset.q] = Number(o.dataset.o); }); show(cur, false); }
  });
  panel.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.w) save((s) => { s.w = s.w ?? {}; s.w[t.dataset.w] = t.value; });
    if (t.dataset.c) save((s) => { s.c = s.c ?? {}; s.c[t.dataset.c] = t.checked; });
  });
  show(0, false);
}

function badgeNote(unit, lesson) {
  if (!isStudent || !lesson.badge || !isEarned(cid, unit, lesson)) return "";
  return `<p class="badge-note is-done">배지를 모았어요. <a href="#/badges">내 배지 보기</a></p>`;
}

// YouTube IFrame API를 한 번만 불러옴
let ytReady = null;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytReady) {
    ytReady = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = () => { ytReady = null; reject(new Error("YouTube API")); };
      document.head.appendChild(tag);
    });
  }
  return ytReady;
}

// 실제로 본 구간만 1초 단위로 셈. 건너뛰기(앞으로 감기)한 구간은 세지 않음.
// 배지 영상 하나를 실제로 70% 이상 보면 바로 배지를 줌.
const WATCH_NEED = 0.7;
function watchBadgeVideos(unit, lesson) {
  const frames = [...document.querySelectorAll("iframe[data-badge-video]")];
  const files = [...document.querySelectorAll("video[data-badge-video]")];
  if ((!frames.length && !files.length) || isEarned(cid, unit, lesson)) return;
  const courseId = cid;
  let done = false;
  const award = () => {
    if (done) return;
    const map = readEarned();
    const key = badgeKey(courseId, unit, lesson);
    if (map[key]) { done = true; return; }
    map[key] = new Date().toISOString().slice(0, 10);
    if (!writeEarned(map)) return;
    done = true;
    celebrate(lesson);
    const head = document.querySelector(".lesson-title");
    head?.classList.remove("not-earned");
    if (head && !head.querySelector(".badge-note")) {
      head.querySelector("div")?.insertAdjacentHTML("beforeend", `<p class="badge-note is-done">배지를 모았어요. <a href="#/badges">내 배지 보기</a></p>`);
    }
    updateBadgeLink();
  };

  // mp4 파일 영상: 유튜브와 같은 기준 (건너뛴 구간은 세지 않음)
  files.forEach((el) => {
    const seen = new Set();
    let last = null;
    el.addEventListener("play", () => { last = el.currentTime; });
    el.addEventListener("seeking", () => { last = null; });
    el.addEventListener("seeked", () => { last = el.currentTime; });
    el.addEventListener("timeupdate", () => {
      if (done || el.seeking) return;
      const t = el.currentTime;
      if (last !== null && t > last && t - last <= 1.25) {
        for (let k = Math.floor(last); k <= Math.floor(t); k++) seen.add(k);
      }
      last = t;
      const dur = el.duration || 0;
      if (dur > 0 && seen.size / Math.max(1, Math.floor(dur)) >= WATCH_NEED) award();
    });
  });
  if (!frames.length) return;

  loadYT().then((YT) => frames.forEach((frame) => {
    if (!frame.isConnected) return;
    const seen = new Set();
    let last = null, timer = null, player = null;
    const tick = () => {
      if (!frame.isConnected || done) { clearInterval(timer); return; }
      const t = player.getCurrentTime?.();
      if (typeof t !== "number") return;
      // 0.5초마다 확인: 그 사이 1.25초 넘게 앞으로 갔으면 건너뛰기로 보고 세지 않음 (2배속까지는 셈)
      if (last !== null && t > last && t - last <= 1.25) {
        for (let k = Math.floor(last); k <= Math.floor(t); k++) seen.add(k);
      }
      last = t;
      const dur = player.getDuration?.() || 0;
      if (dur > 0 && seen.size / Math.max(1, Math.floor(dur)) >= WATCH_NEED) award();
    };
    player = new YT.Player(frame, {
      events: {
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            last = player.getCurrentTime?.() ?? null;
            clearInterval(timer); timer = setInterval(tick, 500);
          } else { clearInterval(timer); tick(); last = null; }
        },
      },
    });
  })).catch(() => {});
}

function celebrate(lesson) {
  document.querySelector(".badge-toast")?.remove();
  const t = document.createElement("div");
  t.className = "badge-toast";
  t.setAttribute("role", "status");
  t.innerHTML = `${badgeImg(lesson, "toast-badge")}<p><b>${lesson.no}${LW()} 배지를 받았어요!</b><a href="#/badges">내 배지 보기</a></p>
    <button type="button" aria-label="닫기">${icon.close}</button>`;
  t.querySelector("button").addEventListener("click", () => t.remove());
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("is-in"), 20);
  setTimeout(() => t.remove(), 8000);
}

function earnedCount() { return Object.keys(readEarned()).length; }
function updateBadgeLink() {
  const a = document.getElementById("badge-link");
  if (a) a.innerHTML = `내 배지 <b>${earnedCount()}</b>`;
}

/* ---------- 생각해 볼 질문에 내 생각 쓰기 (학생용) ----------
   쓴 답은 이 기기 브라우저에만 저장. 그림으로 저장해 선생님께 낼 수 있음. */
const NOTES_KEY = "snja-notes-v1";
const readNotes = () => { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") || {}; } catch { return {}; } };
const writeNotes = (m) => { try { localStorage.setItem(NOTES_KEY, JSON.stringify(m)); return true; } catch { return false; } };

function notesSection(unit, lesson) {
  if (!isStudent || !lesson.questions?.length) return "";
  const saved = readNotes()[badgeKey(cid, unit, lesson)] ?? [];
  return `
    <section class="notes" aria-labelledby="notes-h">
      <h2 id="notes-h">생각해 볼 질문</h2>
      <ol>
        ${lesson.questions.map((q, k) => `<li>
          <label for="note-${k}">${esc(q)}</label>
          <textarea id="note-${k}" data-k="${k}" rows="3" placeholder="내 생각을 써 보세요.">${esc(saved[k] ?? "")}</textarea>
        </li>`).join("")}
      </ol>
      <div class="notes-tools">
        <button class="btn-primary" type="button" id="notes-save">내 생각 그림으로 저장</button>
        <span class="notes-status" id="notes-status" aria-live="polite"></span>
      </div>
      <p class="notes-help">쓴 내용은 이 기기에만 자동으로 저장돼요. 그림으로 저장해 선생님께 보여 주세요.</p>
    </section>`;
}

function bindNotes(unit, lesson) {
  const box = document.querySelector(".notes");
  if (!box) return;
  const key = badgeKey(cid, unit, lesson);
  const status = document.getElementById("notes-status");
  let t = null;
  box.querySelectorAll("textarea").forEach((ta) => ta.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const all = readNotes();
      all[key] = [...box.querySelectorAll("textarea")].map((x) => x.value);
      status.textContent = writeNotes(all) ? "저장했어요" : "이 기기에 저장할 수 없어요. 그림으로 저장해 두세요.";
    }, 400);
  }));
  document.getElementById("notes-save").addEventListener("click", () => saveNotesImage(lesson,
    lesson.questions.map((q, k) => ({ q, a: box.querySelector(`#note-${k}`).value.trim() }))));
}

// 띄어쓰기 단위로 폭에 맞춰 줄바꿈 (한 낱말이 너무 길면 글자 단위)
function wrapLines(x, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const tryLine = line ? `${line} ${word}` : word;
      if (x.measureText(tryLine).width <= maxW) { line = tryLine; continue; }
      if (line) out.push(line);
      line = "";
      for (const ch of word) {
        if (x.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; } else line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

async function saveNotesImage(lesson, items) {
  await document.fonts?.ready;
  const W = 1200, pad = 72, maxW = W - pad * 2;
  const disp = '"Gaegu", "Nanum Pen Script", cursive', body = '"Gothic A1", "Malgun Gothic", sans-serif';
  const ink = "#0b0b45", sub = "#4a4a6a", accent = "#3a9bfa";
  const c = document.createElement("canvas"); const x = c.getContext("2d");
  // 1) 높이 계산
  const plan = [];
  x.font = `700 30px ${body}`;
  items.forEach(({ q, a }, k) => {
    x.font = `700 30px ${body}`; const ql = wrapLines(x, `${k + 1}. ${q}`, maxW);
    x.font = `400 30px ${body}`; const al = wrapLines(x, a || "(아직 쓰지 않았어요)", maxW - 24);
    plan.push({ ql, al, empty: !a });
  });
  let H = pad + 40 + 80 + 50;
  plan.forEach(({ ql, al }) => { H += ql.length * 44 + 16 + al.length * 46 + 56; });
  H += 40 + pad;
  c.width = W; c.height = H;
  // 2) 그리기
  x.fillStyle = "#fffdf8"; x.fillRect(0, 0, W, H);
  x.strokeStyle = ink; x.lineWidth = 4; x.strokeRect(20, 20, W - 40, H - 40);
  let y = pad + 20;
  x.fillStyle = sub; x.font = `500 26px ${body}`; x.fillText(`${course.title} · ${lesson.no}${LW()}`, pad, y);
  y += 70; x.fillStyle = ink; x.font = `700 60px ${disp}`; x.fillText(`${lesson.title} — 내 생각`, pad, y);
  y += 30; x.fillStyle = accent; x.fillRect(pad, y, 120, 5); y += 60;
  plan.forEach(({ ql, al, empty }) => {
    x.fillStyle = ink; x.font = `700 30px ${body}`;
    ql.forEach((l) => { x.fillText(l, pad, y); y += 44; });
    y += 16;
    x.fillStyle = empty ? "#a0a0b4" : "#222240"; x.font = `400 30px ${body}`;
    const top = y - 34;
    al.forEach((l) => { x.fillText(l, pad + 24, y); y += 46; });
    x.fillStyle = accent; x.fillRect(pad, top, 5, y - top - 20);
    y += 56;
  });
  x.fillStyle = sub; x.font = `400 24px ${body}`;
  const d = new Date(); x.fillText(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · ${siteTitle}`, pad, H - pad + 10);
  const a = document.createElement("a");
  a.download = `${course.title}_${lesson.no}${LW()}_내 생각.png`;
  a.href = c.toDataURL("image/png");
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- 내 배지 (학생용) ---------- */

async function loadAllCourses() {
  for (const c of courses) {
    if (!loaded[c.id]) {
      try {
        const data = await (await fetch(c.file, { cache: "no-cache" })).json();
        loaded[c.id] = { course: data.course, units: data.units ?? [] };
      } catch { /* 못 불러온 교재는 건너뜀 */ }
    }
  }
}

async function renderBadges() {
  app.innerHTML = `<p class="status">불러오는 중…</p>`;
  await loadAllCourses();
  const map = readEarned();
  const blocks = courses.filter((c) => loaded[c.id]).map((c) => {
    const { course: co, units: us } = loaded[c.id];
    const items = us.flatMap((u) => u.lessons.filter((l) => l.badge).map((l) => ({ u, l })));
    if (!items.length) return "";
    const got = items.filter(({ u, l }) => map[`${c.id}/${u.id}/${l.no}`]).length;
    return `
      <section class="shelf">
        <h2><a href="${homeHref(c.id)}">${c.grade ? `<span class="tab-grade">${c.grade}</span>` : ""}${esc(co.title)}</a><span class="shelf-count">${got} / ${items.length}</span></h2>
        ${got === items.length ? `<p class="shelf-done">배지를 모두 모았어요! <a class="btn-primary" href="#/cert/${encodeURIComponent(c.id)}">인증서 받기</a></p>` : ""}
        <ul class="shelf-badges">
          ${items.map(({ u, l }) => {
            const when = map[`${c.id}/${u.id}/${l.no}`];
            return `<li class="${when ? "is-earned" : "not-earned"}">
              <a href="${homeHref(c.id)}/lesson/${encodeURIComponent(u.id)}/${l.no}">
                ${badgeImg(l, "shelf-badge")}
                <span>${l.no}${co.lessonWord || "차시"}</span>
                <span class="sr-only">${when ? "받음" : "아직"}</span>
              </a></li>`;
          }).join("")}
        </ul>
      </section>`;
  }).join("");
  const total = Object.keys(map).length;
  app.innerHTML = `
    <section class="intro badges-intro">
      <h1>내 배지</h1>
      <p class="intro-note">수업 영상을 보며 모은 배지예요. 지금까지 ${total}개를 모았어요.
        배지 기록은 이 기기에만 남아요.</p>
    </section>
    ${blocks}
    <div class="badges-reset">
      <button class="btn-ghost" type="button" id="reset-1">처음부터 다시 모으기</button>
      <span id="reset-2" hidden>이 기기의 배지가 모두 지워져요.
        <button class="btn-ghost" type="button" id="reset-yes">지우기</button>
        <button class="btn-ghost" type="button" id="reset-no">그만두기</button></span>
    </div>`;
  const r1 = document.getElementById("reset-1"), r2 = document.getElementById("reset-2");
  r1.addEventListener("click", () => { r1.hidden = true; r2.hidden = false; });
  document.getElementById("reset-no").addEventListener("click", () => { r1.hidden = false; r2.hidden = true; });
  document.getElementById("reset-yes").addEventListener("click", () => { writeEarned({}); updateBadgeLink(); renderBadges(); });
  document.querySelectorAll('#tabs [aria-current]').forEach((a) => a.removeAttribute("aria-current"));
  document.title = `내 배지 · ${siteTitle}`;
  window.scrollTo(0, 0);
}

/* ---------- 예술가 배지 완성 인증서 (학생용) ---------- */

const NAME_KEY = "snja-name";
const readName = () => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } };
const writeName = (v) => { try { localStorage.setItem(NAME_KEY, v); } catch { /* 저장 못 해도 인증서는 됨 */ } };
const fmtDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return y ? `${y}년 ${m}월 ${d}일` : ""; };

async function renderCert(courseId) {
  app.innerHTML = `<p class="status">불러오는 중…</p>`;
  await loadAllCourses();
  const entry = courses.find((x) => x.id === courseId);
  const data = entry && loaded[courseId];
  if (!data) { app.innerHTML = `<p class="status">교재를 찾을 수 없어요. <a href="#/badges">내 배지로</a></p>`; return; }
  const { course: co, units: us } = data;
  const map = readEarned();
  const items = us.flatMap((u) => u.lessons.filter((l) => l.badge).map((l) => ({ u, l, when: map[`${courseId}/${u.id}/${l.no}`] })));
  if (!items.length || items.some((x) => !x.when)) {
    const got = items.filter((x) => x.when).length;
    app.innerHTML = `<p class="status">아직 배지를 모두 모으지 않았어요 (${got} / ${items.length}). <a href="#/badges">내 배지로</a></p>`;
    return;
  }
  const done = items.map((x) => x.when).sort().at(-1);
  const issuer = `${siteTitle}${co.author ? ` · 교재 개발 ${co.author}` : ""}`;
  app.innerHTML = `
    <nav class="crumb"><a href="#/badges">내 배지</a></nav>
    <div class="cert-tools">
      <label for="cert-name">이름</label>
      <input id="cert-name" type="text" maxlength="12" autocomplete="off" placeholder="이름을 써 주세요" value="${esc(readName())}">
      <button class="btn-primary" type="button" id="cert-print">인쇄하기</button>
      <button class="btn-ghost" type="button" id="cert-save">그림으로 저장</button>
    </div>
    <p class="cert-help">이름은 이 화면에만 쓰이고 어디로도 보내지 않아요.</p>
    <article class="cert" id="cert">
      <p class="cert-org">${esc(siteTitle)}</p>
      <h1 class="cert-title">예술가 배지 완성 인증서</h1>
      <p class="cert-name"><span id="cert-name-out"></span></p>
      <p class="cert-body">위 학생은 「${esc(co.title)}」 ${items.length}차시 수업 영상을 보며
        배지를 모두 모았기에 이 인증서를 드립니다.</p>
      <ul class="cert-badges">${items.map(({ l }) => `<li>${badgeImg(l, "cert-badge").replace(' loading="lazy"', "")}</li>`).join("")}</ul>
      <p class="cert-date">${fmtDate(done)}</p>
      <p class="cert-issuer">${esc(issuer)}</p>
    </article>`;
  const input = document.getElementById("cert-name");
  const out = document.getElementById("cert-name-out");
  const sync = () => { const v = input.value.trim(); out.textContent = v || "이름"; out.classList.toggle("is-blank", !v); };
  input.addEventListener("input", () => { sync(); writeName(input.value.trim()); });
  sync();
  document.getElementById("cert-print").addEventListener("click", () => window.print());
  document.getElementById("cert-save").addEventListener("click", () =>
    saveCertImage({ name: input.value.trim(), course: co.title, count: items.length, date: fmtDate(done), issuer, badges: [...document.querySelectorAll("#cert .cert-badge")] }));
  document.querySelectorAll('#tabs [aria-current]').forEach((a) => a.removeAttribute("aria-current"));
  document.title = `인증서 · ${co.title}`;
  window.scrollTo(0, 0);
}

// 인증서를 PNG로 그려서 내려받기 (화면 모양과 같게)
async function saveCertImage({ name, course: title, count, date, issuer, badges }) {
  await document.fonts?.ready;
  const W = 1754, H = 1240;                 // A4 가로, 150dpi
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const ink = "#0b0b45", sub = "#4a4a6a", accent = "#3a9bfa";
  const disp = '"Gaegu", "Nanum Pen Script", cursive', body = '"Gothic A1", "Malgun Gothic", sans-serif';
  x.fillStyle = "#fffdf8"; x.fillRect(0, 0, W, H);
  x.strokeStyle = ink; x.lineWidth = 6; x.strokeRect(48, 48, W - 96, H - 96);
  x.lineWidth = 2; x.strokeRect(68, 68, W - 136, H - 136);
  x.textAlign = "center"; x.textBaseline = "alphabetic";
  x.fillStyle = sub; x.font = `500 34px ${body}`; x.fillText(siteTitle, W / 2, 170);
  x.fillStyle = ink; x.font = `700 104px ${disp}`; x.fillText("예술가 배지 완성 인증서", W / 2, 290);
  x.font = `700 84px ${disp}`; x.fillText(name || "", W / 2, 440);
  x.strokeStyle = accent; x.lineWidth = 3; x.beginPath(); x.moveTo(W / 2 - 260, 466); x.lineTo(W / 2 + 260, 466); x.stroke();
  x.fillStyle = sub; x.font = `400 36px ${body}`;
  x.fillText(`위 학생은 「${title}」 ${count}차시 수업 영상을 보며`, W / 2, 556);
  x.fillText("배지를 모두 모았기에 이 인증서를 드립니다.", W / 2, 608);
  const bh = 170, gap = 28;
  const ws = badges.map((im) => (im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 0.85) * bh);
  let bx = (W - (ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1))) / 2;
  badges.forEach((im, i) => { try { x.drawImage(im, bx, 680, ws[i], bh); } catch { /* 그림 못 그리면 건너뜀 */ } bx += ws[i] + gap; });
  x.fillStyle = ink; x.font = `500 38px ${body}`; x.fillText(date, W / 2, 980);
  x.font = `700 40px ${body}`; x.fillText(issuer, W / 2, 1060);
  const a = document.createElement("a");
  a.download = `예술가 배지 완성 인증서_${title}${name ? `_${name}` : ""}.png`;
  a.href = c.toDataURL("image/png");
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- 수업 모드 (교실 TV) ---------- */

function openClassMode(lesson) {
  const videos = (lesson.videos ?? []).filter(hasMedia);
  const video = videos[0];
  // 파트가 있는 영상은 파트가 곧 수업 단계: 단계를 고르면 그 구간만 재생하고 끝나면 멈춤 (유튜브 영상만)
  const parts = video?.parts?.length && String(video.youtubeId ?? "").trim() ? video.parts : null;
  const steps = parts
    ? parts.map((p) => {
        const acts = [...new Set((p.activity ?? []).map((a) => ({ write: "생각 쓰기", quiz: "개념 퀴즈", check: "미션 체크" })[a.type]).filter(Boolean))];
        if (p.links?.length) acts.unshift("자료 영상");
        return `${p.title} (${fmtTime(p.end - p.start)})${p.summary ? `: ${p.summary}` : ""}${acts.length ? ` [${acts.join(" · ")}]` : ""}`;
      })
    : lesson.steps ?? [];
  const embedSrc = (v) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(String(v.youtubeId).trim())}?rel=0`;
  const cmPlayer = (v) => String(v.youtubeId ?? "").trim()
    ? `<iframe src="${embedSrc(v)}" title="${esc(v.title || "수업 영상")}" allowfullscreen
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"></iframe>`
    : fileVideo(v);
  let current = 0;

  const overlay = document.createElement("div");
  overlay.className = "classmode";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${lesson.title} 수업 모드`);
  overlay.innerHTML = `
    <div class="cm-top">
      <p>${badgeImg(lesson, "cm-badge")}<span>${lesson.no}${LW()}</span> ${esc(lesson.title)}</p>
      <span class="cm-top-tools">
        ${lesson.artist ? `<button class="cm-artist-btn" type="button">작가 소개</button>` : ""}
        <button class="cm-close" type="button" aria-label="수업 모드 닫기">${icon.close}</button>
      </span>
    </div>
    <div class="cm-viewer" hidden>
      <div class="cm-viewer-bar"><b class="cm-viewer-title"></b>
        <a class="cm-viewer-out" target="_blank" rel="noopener">새 창으로 ${icon.external}</a>
        <button type="button" class="cm-viewer-close" aria-label="자료 닫기">${icon.close}</button></div>
      <div class="cm-viewer-body"></div>
    </div>
    <div class="cm-body${video ? "" : " no-video"}">
      ${video ? `<div class="cm-media">
        <div class="cm-player">${parts ? `<div data-cm-yt></div>` : cmPlayer(video)}</div>
        ${videos.length > 1 ? `<div class="cm-videos" role="group" aria-label="영상 고르기">
          ${videos.map((v, k) => `<button type="button" data-v="${k}" aria-pressed="${k === 0}"><span>${k + 1}</span>${esc(v.title || `영상 ${k + 1}`)}</button>`).join("")}
        </div>` : ""}
        <div class="cm-links" aria-label="이 단계 자료"></div>
      </div>` : ""}
      <div class="cm-steps">
        ${lesson.goal ? `<p class="cm-goal">${esc(lesson.goal)}</p>` : ""}
        ${steps.length ? `<ol>${steps.map((s, k) => `<li data-k="${k}">${esc(s)}</li>`).join("")}</ol>` : ""}
      </div>
    </div>
    ${steps.length ? `
    <div class="cm-nav">
      <button type="button" data-move="-1" aria-label="이전 단계">${icon.left}</button>
      <span class="cm-count" aria-live="polite"></span>
      <button type="button" data-move="1" aria-label="다음 단계">${icon.right}</button>
    </div>` : ""}`;

  // 파트 재생기
  let yt = null, stopAt = null, ytTimer = null;
  if (parts) {
    loadYT().then((YT) => {
      const el = overlay.querySelector("[data-cm-yt]");
      if (!el) return;
      const pl = new YT.Player(el, { videoId: String(video.youtubeId).trim(), host: "https://www.youtube-nocookie.com",
        playerVars: { rel: 0, playsinline: 1 }, events: { onReady: () => { yt = pl; } } });
      ytTimer = setInterval(() => {
        if (!overlay.isConnected) { clearInterval(ytTimer); return; }
        if (yt && stopAt !== null && (yt.getCurrentTime?.() ?? 0) >= stopAt - 0.15) { yt.pauseVideo(); stopAt = null; }
      }, 250);
    }).catch(() => {});
  }
  const playPart = (k) => {
    if (!parts || !yt) return;
    yt.seekTo(parts[k].start, true); yt.playVideo(); stopAt = parts[k].end;
  };

  // 단계 자료 링크: 유튜브와 이 사이트들은 수업 모드 안에서 바로 열고, 나머지는 새 창으로
  const ytId = (u) => { try { const x = new URL(u); if (x.hostname === "youtu.be") return [x.pathname.slice(1), x.searchParams.get("t")]; if (/youtube\.com$/.test(x.hostname)) return [x.searchParams.get("v"), x.searchParams.get("t")]; } catch {} return [null, null]; };
  const viewer = overlay.querySelector(".cm-viewer");
  const openLink = (title, url) => {
    const [id, t] = ytId(url);
    const inSite = /^https:\/\/biossam\.github\.io\//.test(url);
    if (!id && !inSite) { window.open(url, "_blank", "noopener"); return; }
    yt?.pauseVideo?.();
    const src = id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&autoplay=1${t ? `&start=${parseInt(t, 10) || 0}` : ""}` : url;
    viewer.querySelector(".cm-viewer-title").textContent = title;
    viewer.querySelector(".cm-viewer-out").href = url;
    viewer.querySelector(".cm-viewer-body").innerHTML = `<iframe src="${esc(src)}" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; camera" allowfullscreen></iframe>`;
    viewer.hidden = false;
  };
  const openArtist = () => {
    const a = lesson.artist;
    viewer.querySelector(".cm-viewer-title").textContent = `작가 소개 · ${a.name}`;
    const first = (a.links ?? []).map((l) => safeUrl(l.url)).find(Boolean) || "";
    const out = viewer.querySelector(".cm-viewer-out");
    out.hidden = !first; if (first) out.href = first;
    viewer.querySelector(".cm-viewer-body").innerHTML = `<article class="cm-artist">
      <p class="cm-artist-kicker">${lesson.no}${LW()} 작가</p>
      <h2>${esc(a.name)}${a.life ? ` <small>${esc(a.life)}</small>` : ""}</h2>
      ${(a.intro ?? []).map((t) => `<p>${esc(t)}</p>`).join("")}
      ${a.work ? `<p class="cm-artist-work"><span>대표 작업</span>${esc(a.work)}</p>` : ""}
      ${a.ask ? `<p class="cm-artist-ask">${esc(a.ask)}</p>` : ""}
      ${(a.links ?? []).length ? `<ul>${a.links.map((l) => safeUrl(l.url) ? `<li><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.title)} ${icon.external}</a></li>` : "").join("")}</ul>` : ""}
    </article>`;
    viewer.hidden = false;
  };
  const closeViewer = () => { viewer.hidden = true; viewer.querySelector(".cm-viewer-body").innerHTML = ""; viewer.querySelector(".cm-viewer-out").hidden = false; };
  viewer.querySelector(".cm-viewer-close").addEventListener("click", closeViewer);
  overlay.querySelector(".cm-artist-btn")?.addEventListener("click", openArtist);
  const paintLinks = () => {
    const box = overlay.querySelector(".cm-links");
    if (!box) return;
    const p = parts?.[current];
    const links = (p?.links ?? []).map((l) => ({ title: (!isStudent && l.teacherTitle) || l.title, url: safeUrl((!isStudent && l.teacherUrl) || l.url) })).filter((l) => l.url);
    box.innerHTML = links.map((l, k) => `<button type="button" data-l="${k}">${icon.external}<span>${esc(l.title)}</span></button>`).join("");
    box.querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", () => { const l = links[Number(b.dataset.l)]; openLink(l.title, l.url); }));
  };

  const update = () => {
    paintLinks();
    overlay.querySelectorAll(".cm-steps li").forEach((li, k) => {
      li.classList.toggle("is-current", k === current);
      li.classList.toggle("is-done", k < current);
      if (k === current) li.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    const count = overlay.querySelector(".cm-count");
    if (count) count.textContent = `${current + 1} / ${steps.length}`;
  };

  const move = (d) => {
    if (!steps.length) return;
    current = Math.min(steps.length - 1, Math.max(0, current + d));
    update(); playPart(current);
  };

  const close = () => {
    document.removeEventListener("keydown", onKey);
    clearInterval(ytTimer);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    overlay.remove();
    document.body.classList.remove("no-scroll");
    document.getElementById("class-mode")?.focus();
  };

  const onKey = (e) => {
    if (!viewer.hidden && e.key !== "Escape") return;   // 자료를 보는 중에는 단계가 넘어가지 않음
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); move(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); move(-1); }
    else if (e.key === "Escape") { if (!viewer.hidden) closeViewer(); else close(); }
    else if (/^[1-9]$/.test(e.key)) overlay.querySelector(`.cm-videos [data-v="${Number(e.key) - 1}"]`)?.click();
  };

  overlay.querySelector(".cm-close").addEventListener("click", close);
  overlay.querySelectorAll("[data-move]").forEach((b) =>
    b.addEventListener("click", () => move(Number(b.dataset.move))));
  overlay.querySelectorAll(".cm-steps li").forEach((li) =>
    li.addEventListener("click", () => { current = Number(li.dataset.k); update(); playPart(current); }));
  overlay.querySelectorAll(".cm-videos button").forEach((b) =>
    b.addEventListener("click", () => {
      const v = videos[Number(b.dataset.v)];
      overlay.querySelector(".cm-player").innerHTML = cmPlayer(v);
      overlay.querySelectorAll(".cm-videos button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  document.body.classList.add("no-scroll");
  overlay.requestFullscreen?.().catch(() => {});
  update();
  overlay.querySelector(".cm-close").focus();
}

/* ---------- QR 코드 화면 ---------- */

function renderQR() {
  // 기본 교재는 짧은 주소, 나머지는 교재 주소까지 담음
  const studentUrl = `${location.origin}${location.pathname}?view=student${cid === defaultId ? "" : homeHref()}`;
  const shortText = studentUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  let qrSvg = `<p class="status">QR 코드를 만들 수 없어요. 아래 주소를 알려 주세요.</p>`;
  if (typeof window.qrcode === "function") {
    const qr = window.qrcode(0, "M");
    qr.addData(studentUrl);
    qr.make();
    qrSvg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true, alt: "학생용 화면 QR 코드" });
  }

  app.innerHTML = `
    <nav class="crumb"><a href="${homeHref()}">${esc(course.title)}</a></nav>
    <section class="qr-page">
      <div class="qr-box">${qrSvg}</div>
      <div class="qr-text">
        <h1>학생용 화면</h1>
        <p class="qr-course">${esc(course.title)}</p>
        <p>휴대폰 카메라로 찍으면 영상만 보이는 학생용 화면이 열립니다. 교실 화면에 띄우거나 인쇄해 알림장에 붙여 쓰세요.</p>
        <p class="qr-url">${esc(shortText)}</p>
        <div class="qr-actions">
          <button class="btn-primary" type="button" id="qr-print">인쇄하기</button>
          <a class="btn-ghost" href="${esc(studentUrl)}" target="_blank" rel="noopener">학생용 화면 열기</a>
        </div>
      </div>
    </section>`;
  document.getElementById("qr-print").addEventListener("click", () => window.print());
  document.title = `QR 코드 · ${course.title}`;
}

/* ---------- 시작 ---------- */

// 주소 모양
//   #/c/{교재}                     교재 첫 화면
//   #/c/{교재}/lesson/{단원}/{차시}[/v{영상}]
//   #/c/{교재}/qr
//   예전 주소(#/, #/lesson/…, #/qr)는 site.json의 default 교재(휴먼스킬아트)로 엽니다.
async function route() {
  let hash = location.hash || "#/";
  const certM = hash.match(/^#\/cert\/([^/]+)$/);
  if ((hash === "#/badges" || certM) && isStudent) {
    if (!cid) { const d = courses.find((x) => x.id === defaultId); /* 머리말을 그리려면 교재 하나는 필요 */
      const data = await (await fetch(d.file, { cache: "no-cache" })).json();
      loaded[d.id] = loaded[d.id] || { course: data.course, units: data.units ?? [] };
      cid = d.id; ({ course, units } = loaded[d.id]); renderChrome(); }
    return certM ? renderCert(decodeURIComponent(certM[1])) : renderBadges();
  }
  let id = defaultId;
  const c = hash.match(/^#\/c\/([^/]+)(.*)$/);
  if (c) { id = decodeURIComponent(c[1]); hash = `#${c[2] || "/"}`; }
  if (!courses.some((x) => x.id === id)) id = defaultId;

  if (id !== cid || !loaded[id]) {
    if (!loaded[id]) {
      app.innerHTML = `<p class="status">불러오는 중…</p>`;
      const entry = courses.find((x) => x.id === id);
      const res = await fetch(entry.file, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      loaded[id] = { course: data.course, units: data.units ?? [] };
    }
  }
  cid = id;
  ({ course, units } = loaded[id]);
  renderChrome();

  const m = hash.match(/^#\/lesson\/([^/]+)\/(\d+)(?:\/v(\d+))?$/);
  if (m) return renderLesson(decodeURIComponent(m[1]), m[2], m[3] ? Number(m[3]) : 0);
  if (hash === "#/qr" && !isStudent) return renderQR();
  renderHome();
}

function renderChrome() {
  const label = document.getElementById("view-label");
  if (isStudent) { label.innerHTML = `<a id="badge-link" href="#/badges"></a>`; updateBadgeLink(); }
  else label.textContent = "선생님 자료실";
  const brand = document.getElementById("brand");
  brand.textContent = siteTitle;
  // 연도: 지금 교재의 연도. 연구회 이름은 기본 교재 연도의 첫 탭으로
  const yearOf = (id) => courses.find((x) => x.id === id)?.year;
  const curYear = yearOf(cid) ?? yearOf(defaultId);
  const firstOf = (y) => courses.find((x) => x.year === y)?.id ?? courses[0].id;
  brand.setAttribute("href", homeHref(firstOf(yearOf(defaultId))));
  const years = [...new Set(courses.map((x) => x.year).filter(Boolean))].sort();
  document.getElementById("years").innerHTML = years.length > 1
    ? years.map((y) => `<a href="${homeHref(firstOf(y))}"${y === curYear ? ` aria-current="true"` : ""}>${y}</a>`).join("")
    : "";
  // 교재 탭: 지금 연도의 교재만, data/site.json의 courses 순서대로
  document.getElementById("tabs").innerHTML = courses.filter((x) => !curYear || x.year === curYear).map((x) =>
    `<a href="${homeHref(x.id)}"${x.id === cid ? ` aria-current="page"` : ""}${x.tab ? ` title="${esc(x.title)}"` : ""}>${x.grade ? `<span class="tab-grade" title="${x.grade}학년"><span class="sr-only">${x.grade}학년 </span><span aria-hidden="true">${x.grade}</span></span>` : ""}${esc(x.tab || x.title)}</a>`).join("");
  // 고른 탭이 화면 밖이면 탭 줄만 옆으로 밀어 보이게 함 (페이지는 그대로)
  const tabs = document.getElementById("tabs");
  const on = tabs.querySelector('[aria-current="page"]');
  if (on && (on.offsetLeft + on.offsetWidth > tabs.scrollLeft + tabs.clientWidth || on.offsetLeft < tabs.scrollLeft)) {
    tabs.scrollLeft = on.offsetLeft - 16;
  }
  const lic = course.license;
  document.getElementById("footer").innerHTML = `
    <p>${esc(course.title)}${course.author ? `, 개발 ${esc(course.author)}` : ""} · ${esc(siteTitle)}</p>
    ${(course.credits ?? []).length ? `<p>${course.credits.map(esc).join(" / ")}</p>` : ""}
    ${lic ? `<p>이 교재의 글과 활동지는 <a href="${esc(lic.url)}" target="_blank" rel="noopener">${esc(lic.name)}</a> 조건으로 무료 공개합니다. 교육청 로고와 작가 작품의 권리는 각 권리자에게 있습니다.</p>` : ""}`;
}

async function init() {
  try {
    const res = await fetch("data/site.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    siteTitle = data.site?.title ?? "";
    // 학생용 화면에서는 선생님 전용 자료(teacherOnly)를 아예 빼고 시작
    courses = (data.courses ?? []).filter((x) => !(isStudent && x.teacherOnly));
    if (!courses.length) throw new Error("교재 목록이 비어 있음");
    defaultId = courses.some((x) => x.id === data.site?.default) ? data.site.default : courses[0].id;
    window.addEventListener("hashchange", () => route().catch(fail));
    await route();
  } catch (e) { fail(e); }
}

function fail(e) {
  console.error(e);
  app.innerHTML = `<p class="status">수업 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>`;
}

init();
