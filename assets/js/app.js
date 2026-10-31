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
  return [t.worksheet, t.ppt].filter(Boolean).length;
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
  if (lesson.slides?.count && !(isStudent && course.slidesTeacherOnly)) parts.push(`PPT ${lesson.slides.count}장`);
  if (lesson.sheet?.parts?.length) parts.push("활동지");
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
                ${lesson.stage ? `<span class="stage-chip" data-stage="${esc(lesson.stage[0])}">${esc(lesson.stage)}</span>` : ""}
                <span class="step-status">${esc(lessonStatus(lesson))}</span>
              </span>
              ${thumbId ? `<img class="step-thumb" src="${thumbOf(vids[0])}" alt="" loading="lazy">` : slidesVisible(lesson) ? `<img class="step-thumb is-slide" src="${esc(slideSrc(lesson, 1))}" alt="" loading="lazy">` : ""}
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
      <p class="intro-note">${[course.grade, course.subject].filter(Boolean).map(esc).join(" ")}${course.grade || course.subject ? ", " : ""}${lessonCount}${LW()}${course.author ? ` · ${esc(course.author)}` : ""}${course.slideCourse ? "" : `.
        ${isStudent
          ? `${LW()}${LW() === "편" ? "을" : "를"} 골라 수업 영상을 다시 볼 수 있어요.`
          : (course.noWorksheet ? `${LW()}마다 수업 영상을 파트별로 보며 활동할 수 있습니다.` : `${LW()}마다 수업 영상을 보고 활동지를 무료로 받을 수 있습니다.`)}`}</p>
      ${course.keyQuestion ? `<div class="key-question"><span>${esc(course.keyLabel || "핵심 질문")}</span>${esc(course.keyQuestion)}</div>` : ""}
      ${(course.points ?? []).length ? `<div class="points"><p class="points-title">모아 보는 칭찬포인트</p><ul>${course.points.map((x) => `<li title="${esc(x.desc || "")}">${x.img ? `<img src="${esc(x.img)}" alt="" width="60" height="72" loading="lazy">` : ""}<b>${esc(x.name)}</b><small>${esc(x.desc || "")}</small></li>`).join("")}</ul></div>` : ""}
      ${isStudent ? "" : `<a class="text-link" href="${homeHref()}/qr">학생용 QR 코드 보기</a>`}
      ${isStudent || !course.slideCourse ? "" : `<a class="text-link" href="${homeHref()}/live/1">실시간 현황 보기</a>`}
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

// 수업 자료 그림(그래프 등)과 바깥 자료 링크. 학생 화면에도 보임
function figuresSection(lesson) {
  const figs = (lesson.figures ?? []).filter((f) => safeUrl(f.src));
  const links = (lesson.links ?? []).filter((l) => safeUrl(l.url));
  if (!figs.length && !links.length) return "";
  return `
    <section class="figures">
      <h2>수업 자료</h2>
      ${figs.length ? `<div class="figure-grid">${figs.map((f) => `
        <figure class="figure${f.level ? ` level-${esc(f.level)}` : ""}">
          ${f.level ? `<span class="figure-level">${esc(f.level)}</span>` : ""}
          <a href="${esc(safeUrl(f.src))}" target="_blank" rel="noopener"><img src="${esc(safeUrl(f.src))}" alt="${esc(f.alt || f.caption || "")}" loading="lazy"></a>
          ${f.caption ? `<figcaption>${esc(f.caption)}${f.source ? `<small>${esc(f.source)}</small>` : ""}</figcaption>` : ""}
        </figure>`).join("")}</div>` : ""}
      ${links.length ? `<ul class="files">${links.map((l) => `<li><a class="file" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${icon.external}<span>${esc(l.title)}</span><span class="format">${esc(l.source || "외부 사이트")}</span></a></li>`).join("")}</ul>` : ""}
    </section>`;
}

// 성장 MAP 전략(동기 M · 성찰 A · 맞춤 P)과 기대효과, 선생님 준비 메모. 선생님 화면에만 보임
function strategySection(lesson) {
  if (isStudent) return "";
  const st = lesson.strategy ?? [];
  const tips = lesson.prep ?? [];
  if (!st.length && !tips.length) return "";
  return `
    <section class="strategy">
      <h2>성장 MAP 전략</h2>
      ${st.length ? `<ol class="strategy-list">${st.map((x) => `
        <li><span class="stage-chip" data-stage="${esc((x.stage || "")[0] || "")}">${esc(x.stage || "")}</span>
          <div><p class="strategy-tool">${(x.tools ?? []).map(esc).join("<br>")}</p>
          <p class="strategy-effect">${esc(x.effect || "")}</p></div></li>`).join("")}</ol>` : ""}
      ${tips.length ? `<div class="prep"><h3>준비와 진행 메모</h3><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
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
  // course.platformOnly: 지도안·PPT·활동지를 사이트에서 직접 주지 않고 외부 플랫폼으로만 안내
  const files = course.noWorksheet || course.platformOnly ? [] : [
    ...(t.ppt || lesson.slides ? [{ label: "수업 PPT", url: t.ppt, kind: "PowerPoint" }] : []),
    { label: "수업 활동지", url: t.worksheet, kind: "Word" },
  ];
  const items = files.map((f) => {
    const url = safeUrl(f.url);
    // 사이트 안에 올린 파일은 "휴먼스킬아트_1차시_수업 활동지.hwpx" 같은 이름으로 내려받게 함
    const local = url && !/^https?:/i.test(String(f.url).trim());
    const ext = local ? (String(f.url).match(/\.[a-z0-9]+$/i)?.[0] ?? "") : "";
    const dl = local ? ` download="${esc(`${course.title}_${lesson.no}${LW()}_${f.label}${ext}`)}"` : "";
    return url
      ? `<li><a class="file" href="${esc(url)}"${dl} target="_blank" rel="noopener">${icon.download}<span>${f.label}</span><span class="format">${f.kind ? `${f.kind} ` : ""}받기</span></a></li>`
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

  const canClassMode = !isStudent && (lesson.slides?.count || lesson.videos?.length || lesson.steps?.length);
  const deck = slideViewer(lesson);

  app.innerHTML = `
    <nav class="crumb"><a href="${homeHref()}">${esc(course.title)}</a>${units.length > 1 ? ` <span>/</span> ${esc(unit.title)}` : ""}</nav>
    <header class="lesson-head">
      <div class="lesson-title${isStudent && lesson.badge && !isEarned(cid, unit, lesson) ? " not-earned" : ""}">
        ${badgeImg(lesson, "lesson-badge")}
        <div>
          <p class="lesson-kicker">${lesson.no}${LW()}${lesson.stage ? ` <span class="stage-chip" data-stage="${esc(lesson.stage[0])}">${esc(lesson.stage)}</span>` : ""}${lesson.pages ? ` <span class="pages">${esc(lesson.pages)}</span>` : ""}</p>
          <h1>${esc(lesson.title)}</h1>
          ${lesson.topic ? `<p class="lesson-topic">${esc(lesson.topic)}</p>` : ""}
          ${badgeNote(unit, lesson)}
        </div>
      </div>
      ${lesson.goal ? `<p class="goal"><span>학습 목표</span>${esc(lesson.goal)}</p>` : ""}
      ${canClassMode ? `<span class="head-actions"><button class="btn-primary" id="class-mode" type="button">${icon.screen}수업 모드</button>${lesson.sheet && !isStudent ? `<a class="btn-ghost" href="${homeHref()}/live/${lesson.no}" target="_blank" rel="noopener">실시간 현황</a>` : ""}</span>` : ""}
    </header>

    ${deck}
    ${videos && !(deck && lesson.slides?.videos?.length) ? `<div class="videos">${videos}</div>` : deck ? "" : `<p class="empty-note">수업 영상은 준비 중입니다.</p>`}

    ${artistSection(lesson)}

    ${figuresSection(lesson)}

    ${sheetHtml(lesson)}

    ${details
      ? `<div class="details">${details}</div>`
      : `<p class="empty-note">이 ${LW()}의 활동 안내는 준비 중입니다.</p>`}

    ${lesson.sheet ? "" : notesSection(unit, lesson)}

    ${strategySection(lesson)}

    ${teacherSection(lesson)}

    <nav class="pager">
      ${prev ? `<a href="${lessonHref(prev.unit, prev.lesson)}"><span>이전 ${LW()}</span>${esc(prev.lesson.title)}</a>` : "<span></span>"}
      ${next ? `<a class="next" href="${lessonHref(next.unit, next.lesson)}"><span>다음 ${LW()}</span>${esc(next.lesson.title)}</a>` : ""}
    </nav>`;

  document.getElementById("class-mode")?.addEventListener("click", () => (lesson.slides?.count ? openSlideMode(lesson, 0) : openClassMode(lesson)));
  bindSlideViewer(lesson);
  bindSheet(lesson);
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

async function saveNotesImage(lesson, items, opt = {}) {
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
  x.fillStyle = sub; x.font = `500 26px ${body}`; x.fillText(`${course.title} · ${lesson.no}${LW()}${opt.who ? ` · ${opt.who}` : ""}`, pad, y);
  y += 70; x.fillStyle = ink; x.font = `700 60px ${disp}`; x.fillText(opt.title || `${lesson.title} — 내 생각`, pad, y);
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
  a.download = `${course.title}_${lesson.no}${LW()}_${opt.file || "내 생각"}.png`;
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
      <p class="intro-note">활동지를 끝내고 "활동지 그림으로 저장"을 누르면 받는 배지예요. 지금까지 ${total}개를 모았어요.
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
  // 교실 링크 교사 화면에서 "실시간 현황"으로 열면 주소 끝에 &room=…&key=… 가 붙어 옴 → 기억하고 주소에서 지움
  const hk = hash.match(/^(#[^&]*)&(.*)$/);
  if (hk) {
    const q = new URLSearchParams(hk[2]);
    if (q.get("room") && q.get("key") && !isStudent) writeJSON(LIVE_T_KEY, { room: q.get("room").toUpperCase(), code: q.get("key") });
    hash = hk[1];
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  }
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
  const lv = hash.match(/^#\/live(?:\/(\d+))?$/);
  if (lv && !isStudent) return renderLive(lv[1] ?? "1");
  renderHome();
}

function renderChrome() {
  const label = document.getElementById("view-label");
  // 배지 그림이 있는 차시가 하나라도 있을 때만 "내 배지" 링크를 보여 줌
  const hasBadges = (units ?? []).some((u) => (u.lessons ?? []).some((l) => l.badge));
  if (isStudent) { label.innerHTML = hasBadges ? `<a id="badge-link" href="#/badges"></a>` : "학생용"; updateBadgeLink(); }
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
    ${lic ? `<p>이 교재의 글과 활동지는 <a href="${esc(lic.url)}" target="_blank" rel="noopener">${esc(lic.name)}</a> 조건으로 무료 공개합니다. ${esc(lic.footer ?? "교육청 로고와 작가 작품의 권리는 각 권리자에게 있습니다.")}</p>` : ""}`;
}

async function init() {
  try {
    const res = await fetch("data/site.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    siteTitle = data.site?.title ?? "";
    LIVE.url = String(data.site?.live?.url ?? "").trim();
    // QR·링크로 들어온 수업 코드는 기기에 기억해 둠
    const roomQ = new URLSearchParams(location.search).get("room");
    if (roomQ && isStudent) { const me = readJSON(ME_KEY); me.room = roomQ.replace(/[^0-9A-Za-z]/g, "").slice(0, 6).toUpperCase(); writeJSON(ME_KEY, me); }
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

/* ==========================================================================
   성장 MAP: PPT 슬라이드 보기 + 웹 활동지 + PPT 수업 모드
   lesson.slides: { dir, count, titles[], notes[] }  (dir/1.jpg … PPT를 그림으로 바꾼 것)
   lesson.sheet:  { title, parts: [{ title, note, stage, who, slides[], items[] }] }
   활동지 칸 종류: text · fill({} 빈칸) · choice(multi, other) · table(head, rows; 칸: 글자 | {in:"text"|"check"|"pick"}) ·
                  scale(점검표) · cards(하나 고르기) · sort(카드 나누기) · tier(보충·기본·심화 골라 하기) · info
   학생이 쓴 내용은 이 기기 브라우저에만 저장. 그림으로 저장해 모둠학습창·과제 게시판에 올림.
   ========================================================================== */
const SHEET_KEY = "snja-sheet-v1";
// 실시간 수업 서버 (site.json의 site.live.url). 비어 있으면 실시간 기능 없이 기기에만 저장
const LIVE = { url: "", config: {}, connected: false };
const LIVE_T_KEY = "snja-live-teacher-v1";
async function liveCall(body) {
  if (!LIVE.url) throw new Error("실시간 수업 서버가 아직 연결되지 않았어요");
  // text/plain으로 보내 브라우저 사전 확인(CORS preflight) 없이 바로 보냄
  const res = await fetch(LIVE.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "서버 오류");
  if (data.config) LIVE.config = data.config;
  return data;
}
const ME_KEY = "snja-me-v1";
const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch { return {}; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const slideSrc = (lesson, k) => `${lesson.slides.dir}/${k}.jpg`;

/* ---------- PPT 슬라이드 보기 (차시 화면) ---------- */
const slidesVisible = (lesson) => Boolean(lesson.slides?.count) && !(isStudent && course.slidesTeacherOnly);
// 이 슬라이드에서 틀 영상 목록 (lesson.slides.videos: [{slide, youtubeId, title, start}])
const slideVideos = (lesson, n) => (lesson.slides?.videos ?? []).filter((v) => Number(v.slide) === n && String(v.youtubeId ?? "").trim());
const ytEmbed = (v, autoplay = true) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(String(v.youtubeId).trim())}?rel=0${autoplay ? "&autoplay=1" : ""}${v.start ? `&start=${Number(v.start) || 0}` : ""}`;

function slideViewer(lesson) {
  const s = lesson.slides;
  if (!slidesVisible(lesson)) return "";
  const thumbs = Array.from({ length: s.count }, (_, i) => `
    <li><button type="button" data-go="${i}" aria-label="${i + 1}번 슬라이드${s.titles?.[i] ? `: ${esc(s.titles[i])}` : ""}">
      <img src="${esc(slideSrc(lesson, i + 1))}" alt="" loading="lazy" width="160" height="90"><span>${i + 1}</span></button></li>`).join("");
  return `
    <section class="deck" aria-label="수업 PPT">
      <div class="deck-stage">
        <img class="deck-img" src="${esc(slideSrc(lesson, 1))}" alt="${esc(s.titles?.[0] || "1번 슬라이드")}" width="1280" height="720">
        <button type="button" class="deck-nav prev" data-move="-1" aria-label="이전 슬라이드">${icon.left}</button>
        <button type="button" class="deck-nav next" data-move="1" aria-label="다음 슬라이드">${icon.right}</button>
      </div>
      <div class="deck-vids" hidden></div>
      <div class="deck-bar">
        <span class="deck-count" aria-live="polite">1 / ${s.count}</span>
        <span class="deck-title"></span>
        ${isStudent ? "" : `<button type="button" class="btn-ghost deck-from">${icon.screen}이 장부터 수업 모드</button>`}
      </div>
      <ol class="deck-thumbs">${thumbs}</ol>
      ${isStudent ? "" : `<div class="deck-notes"><b>발표자 메모</b><p></p></div>`}
    </section>`;
}

function bindSlideViewer(lesson) {
  const root = document.querySelector(".deck");
  if (!root) return;
  const s = lesson.slides;
  let cur = 0;
  const img = root.querySelector(".deck-img");
  const stage = root.querySelector(".deck-stage");
  const vbox = root.querySelector(".deck-vids");
  const closeVideo = () => { stage.querySelector(".deck-video")?.remove(); img.hidden = false; };
  const show = (i) => {
    cur = Math.max(0, Math.min(s.count - 1, i));
    closeVideo();
    const vids = slideVideos(lesson, cur + 1);
    vbox.hidden = !vids.length;
    vbox.innerHTML = vids.map((v, k) => `<button type="button" class="deck-vid" data-vid="${k}">${icon.screen}<span>이 슬라이드 영상 · <b>${esc(v.title)}</b></span></button>`).join("");
    img.src = slideSrc(lesson, cur + 1);
    img.alt = s.titles?.[cur] || `${cur + 1}번 슬라이드`;
    root.querySelector(".deck-count").textContent = `${cur + 1} / ${s.count}`;
    root.querySelector(".deck-title").textContent = s.titles?.[cur] ?? "";
    const n = root.querySelector(".deck-notes p");
    if (n) { n.textContent = s.notes?.[cur] || "메모 없음"; }
    root.querySelectorAll(".deck-thumbs button").forEach((b, k) => b.setAttribute("aria-current", String(k === cur)));
    const on = root.querySelector(`.deck-thumbs button[data-go="${cur}"]`);
    const strip = root.querySelector(".deck-thumbs");
    if (on && strip) strip.scrollLeft = on.parentElement.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2;
    root.querySelector(".prev").disabled = cur === 0;
    root.querySelector(".next").disabled = cur === s.count - 1;
    // 이 슬라이드에서 쓰는 활동지 칸을 표시
    document.querySelectorAll(".sheet-part").forEach((p) => p.classList.toggle("is-now", (JSON.parse(p.dataset.slides || "[]")).includes(cur + 1)));
  };
  root.addEventListener("click", (e) => {
    const pv = e.target.closest("[data-vid]");
    if (pv) {
      const v = slideVideos(lesson, cur + 1)[Number(pv.dataset.vid)]; if (!v) return;
      closeVideo(); img.hidden = true;
      stage.insertAdjacentHTML("afterbegin", `<div class="deck-video"><iframe src="${esc(ytEmbed(v))}" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        <button type="button" class="deck-video-close" aria-label="영상 닫고 슬라이드 보기">${icon.close}</button></div>`);
      return;
    }
    if (e.target.closest(".deck-video-close")) return closeVideo();
    const m = e.target.closest("[data-move]"); if (m) return show(cur + Number(m.dataset.move));
    const g = e.target.closest("[data-go]"); if (g) return show(Number(g.dataset.go));
    if (e.target.closest(".deck-from")) openSlideMode(lesson, cur);
  });
  root.querySelector(".deck-stage").addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(cur + 1);
    if (e.key === "ArrowLeft") show(cur - 1);
  });
  root.querySelector(".deck-stage").tabIndex = 0;
  // 손가락으로 밀어 넘기기
  let x0 = null;
  root.querySelector(".deck-stage").addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  root.querySelector(".deck-stage").addEventListener("touchend", (e) => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1));
  });
  show(0);
}

/* ---------- 웹 활동지 ---------- */
function sheetState(lesson) { return readJSON(SHEET_KEY)[`${cid}/${lesson.no}`] ?? {}; }

function sheetHtml(lesson, opts = {}) {
  const sh = lesson.sheet;
  if (!sh?.parts?.length) return "";
  const st = sheetState(lesson);
  const me = readJSON(ME_KEY);
  const parts = sh.parts.map((p, pi) => partHtml(lesson, p, pi, st, opts)).join("");
  const live = Boolean(LIVE.url) && isStudent;
  return `
    <section class="sheet${opts.big ? " is-big" : ""}${opts.readonly ? " is-readonly" : ""}" aria-label="${esc(sh.title || "활동지")}">
      ${opts.big || opts.readonly ? "" : `<div class="sheet-head"><h2>활동지</h2><p>${isStudent ? (live ? "여기에 바로 써요. 쓴 내용은 이 기기에 저장되고, 교실 링크 참여 코드를 넣으면 선생님 화면에도 바로 보여요." : "여기에 바로 써요. 쓴 내용은 이 기기에 자동으로 저장돼요.") : "학생 화면에서 학생이 바로 입력하는 활동지예요. 수업 모드에서 크게 띄울 수 있어요."}</p></div>`}
      ${opts.readonly ? "" : `<div class="sheet-me">
        <label>6학년 <input type="text" data-me="ban" value="${esc(me.ban ?? "")}" inputmode="numeric" aria-label="반"> 반</label>
        <label><input type="text" data-me="no" value="${esc(me.no ?? "")}" inputmode="numeric" aria-label="번호"> 번</label>
        <label><input type="text" data-me="group" value="${esc(me.group ?? "")}" inputmode="numeric" aria-label="모둠"> 모둠</label>
        <label>이름 <input type="text" data-me="name" value="${esc(me.name ?? "")}" aria-label="이름" class="me-name"></label>
        ${live ? `<label class="me-room">참여 코드 <input type="text" data-me="room" value="${esc(me.room ?? "")}" maxlength="6" autocapitalize="characters" aria-label="교실 링크 참여 코드" class="me-roomin"></label>
          <span class="live-chip" data-live-chip>연결 안 됨</span>` : ""}
      </div>
      ${live ? `<p class="sheet-privacy">이름은 이 기기에만 남고, 선생님께는 반·번호·모둠과 쓴 내용만 보내요.</p>` : ""}
      ${isStudent && (course.points ?? []).length ? `<div class="my-points" data-my-points hidden></div>` : ""}`}
      ${parts}
      ${opts.readonly ? "" : `<div class="sheet-progress" data-sheet-progress aria-live="polite"></div>
      <div class="sheet-tools">
        ${live ? `<button class="btn-primary" type="button" data-sheet-submit>${icon.right}선생님께 제출</button>` : ""}
        <button class="${live ? "btn-ghost" : "btn-primary"}" type="button" data-sheet-save>${icon.download}활동지 그림으로 저장</button>
        <button class="btn-ghost" type="button" data-sheet-clear>다 지우기</button>
        <span class="sheet-status" aria-live="polite"></span>
      </div>
      <p class="notes-help">${live ? "제출하면 선생님 화면에 \"제출\"로 표시돼요. 그림으로 저장해 모둠학습창에 올릴 수도 있어요." : "그림으로 저장해 모둠학습창이나 과제 게시판에 올려요."}</p>`}
    </section>`;
}

// 이 차시의 이 칸이 모둠이 함께 쓰는 칸인지 (선생님 설정이 있으면 그것, 없으면 교재 기본값)
function isGroupPart(lesson, pi) {
  const g = LIVE.config?.groupParts?.[String(lesson.no)];
  if (Array.isArray(g)) return g.includes(pi);
  return lesson.sheet.parts[pi]?.who === "모둠";
}

function partHtml(lesson, p, pi, st, opts = {}) {
  const v = (id) => st[id];
  const txt = (id, ph = "", lines = 1) => lines > 1
    ? `<textarea data-id="${id}" rows="${lines}" placeholder="${esc(ph || "써 보세요.")}">${esc(v(id) ?? "")}</textarea>`
    : `<input type="text" data-id="${id}" value="${esc(v(id) ?? "")}" placeholder="${esc(ph)}">`;
  const item = (it, id) => {
    switch (it.type) {
      case "info": return `<p class="sh-info">${esc(it.text)}</p>`;
      case "text": return `<label class="sh-field"><span class="sh-label">${esc(it.label)}</span>${txt(id, it.ph, it.lines)}</label>`;
      case "fill": {
        let k = 0;
        const html = esc(it.text).replace(/\{\}/g, () => `<input type="text" class="sh-blank" data-id="${id}.${k}" value="${esc(v(`${id}.${k++}`) ?? "")}" aria-label="빈칸">`);
        return `<p class="sh-fill">${html}</p>`;
      }
      case "choice": {
        const sel = v(id) ?? (it.multi ? [] : null);
        const opts2 = it.options.map((o, k) => {
          const on = it.multi ? sel.includes?.(k) : sel === k;
          return `<button type="button" class="sh-opt" data-choice="${id}" data-k="${k}"${it.multi ? ` data-multi="1"` : ""} aria-pressed="${on}">${esc(o)}</button>`;
        }).join("");
        return `<div class="sh-field"><span class="sh-label">${esc(it.label)}${it.multi ? ` <small>(모두 골라요)</small>` : ""}</span>
          <div class="sh-opts">${opts2}</div>${it.other ? txt(`${id}.other`, "그 밖에") : ""}</div>`;
      }
      case "cards": {
        const sel = v(id);
        return `<div class="sh-field"><span class="sh-label">${esc(it.label)}</span><div class="sh-cards">${it.options.map((o, k) =>
          `<button type="button" class="sh-card" data-choice="${id}" data-k="${k}" aria-pressed="${sel === k}">${o.img ? `<img src="${esc(o.img)}" alt="" width="70" height="84" loading="lazy">` : ""}<b>${esc(o.name)}</b><small>${esc(o.desc || "")}</small></button>`).join("")}</div></div>`;
      }
      case "scale": {
        return `<table class="sh-table sh-scale"><thead><tr><th>점검할 내용</th>${it.options.map((o) => `<th>${esc(o)}</th>`).join("")}</tr></thead><tbody>
          ${it.rows.map((r, ri) => `<tr><th scope="row">${esc(r)}</th>${it.options.map((o, k) =>
            `<td><button type="button" class="sh-dot" data-choice="${id}.${ri}" data-k="${k}" aria-pressed="${v(`${id}.${ri}`) === k}" aria-label="${esc(o)}"></button></td>`).join("")}</tr>`).join("")}
          </tbody></table>`;
      }
      case "table": {
        const cell = (c, ri, ci) => {
          const cidx = `${id}.${ri}.${ci}`;
          if (typeof c === "string") return ri === 0 && it.rows[0][0] === "예" ? `<td class="sh-ex">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`;
          if (c.in === "check") return `<td class="sh-c"><input type="checkbox" data-id="${cidx}"${v(cidx) ? " checked" : ""} aria-label="${esc(it.head[ci])}"></td>`;
          if (c.in === "pick") return `<td><select data-id="${cidx}" aria-label="${esc(it.head[ci])}"><option value="">고르기</option>${c.options.map((o) => `<option${v(cidx) === o ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></td>`;
          return `<td><input type="text" data-id="${cidx}" value="${esc(v(cidx) ?? "")}" placeholder="${esc(c.ph || "")}" aria-label="${esc(it.head[ci])}"></td>`;
        };
        return `${it.note ? `<p class="sh-note">${esc(it.note)}</p>` : ""}<div class="sh-scroll"><table class="sh-table"><thead><tr>${it.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${it.rows.map((r, ri) => `<tr>${r.map((c, ci) => cell(c, ri, ci)).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
      case "sort": {
        return `<div class="sh-field"><span class="sh-label">${esc(it.label)}</span><ul class="sh-sort">${it.cards.map((c, k) => {
          const b = v(`${id}.${k}`);
          return `<li><div><b>${esc(c.name)}</b><small>${esc(c.desc || "")}</small></div><div class="sh-bins">${it.bins.map((bn, bi) =>
            `<button type="button" class="sh-bin bin-${bi}" data-choice="${id}.${k}" data-k="${bi}" aria-pressed="${b === bi}">${esc(bn)}</button>`).join("")}</div></li>`;
        }).join("")}</ul></div>`;
      }
      case "tier": {
        const sel = v(id);
        return `<div class="sh-field sh-tier"><span class="sh-label">${esc(it.label)}</span>
          <div class="sh-tabs">${it.tiers.map((t, k) => `<button type="button" class="sh-tab tab-${k}" data-choice="${id}" data-k="${k}" data-tier="1" aria-pressed="${sel === k}">${esc(t.name)}</button>`).join("")}</div>
          ${it.tiers.map((t, k) => `<div class="sh-tier-body" data-tier-of="${id}" data-k="${k}"${sel === k ? "" : " hidden"}>
            ${t.desc ? `<p class="sh-note">${esc(t.desc)}</p>` : ""}${t.items.map((x, j) => item(x, `${id}.t${k}.${j}`)).join("")}</div>`).join("")}
        </div>`;
      }
      default: return "";
    }
  };
  const group = isGroupPart(lesson, pi);
  return `
    <section class="sheet-part${group ? " is-group" : ""}" data-slides="${esc(JSON.stringify(p.slides ?? []))}" data-pi="${pi}" id="${opts.idPrefix || ""}sheet-p${pi}">
      <header><h3>${esc(p.title)}</h3>
        ${p.stage ? `<span class="stage-chip" data-stage="${esc(p.stage[0])}">${esc(p.stage)}</span>` : ""}
        ${group ? `<span class="sh-who is-group">모둠이 함께 써요</span>` : ""}
        ${p.slides?.length ? `<span class="sh-at">PPT ${p.slides.join("·")}번</span>` : ""}
      </header>
      ${p.note ? `<p class="sh-note">${esc(p.note)}</p>` : ""}
      ${group && LIVE.url && isStudent ? `<p class="sh-note sh-group-note">같은 모둠 친구가 쓴 내용이 몇 초 뒤 여기에도 나타나요.</p>` : ""}
      ${p.items.map((it, ii) => item(it, `p${pi}.${ii}`)).join("")}
    </section>`;
}

function bindSheet(lesson, root = document) {
  const box = root.querySelector(".sheet");
  if (!box) return;
  const key = `${cid}/${lesson.no}`;
  const status = box.querySelector(".sheet-status");
  const say = (t) => { if (!status) return; status.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { status.textContent = ""; }, 2200); };
  const partOf = (id) => Number(String(id).match(/^p(\d+)\./)?.[1] ?? -1);
  const save = (fn, changedId) => {
    const all = readJSON(SHEET_KEY); all[key] = all[key] ?? {}; fn(all[key]);
    // 모둠 칸이 바뀌면 바뀐 시각을 남겨 같은 모둠 친구 화면과 맞춤
    if (changedId && isGroupPart(lesson, partOf(changedId))) { all[key]._gt = all[key]._gt ?? {}; all[key]._gt[changedId] = Date.now(); }
    say(writeJSON(SHEET_KEY, all) ? "저장했어요" : "이 기기에 저장할 수 없어요. 그림으로 저장해 두세요.");
    paintSheetProgress(lesson, box);
    liveSoon(lesson);
  };
  paintSheetProgress(lesson, box);
  paintMyPoints();
  box.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.me) {
      const me = readJSON(ME_KEY); me[t.dataset.me] = t.dataset.me === "room" ? t.value.trim().toUpperCase() : t.value.trim(); writeJSON(ME_KEY, me);
      if (["ban", "no", "group", "room"].includes(t.dataset.me)) liveSoon(lesson, 900);
      return;
    }
    if (t.dataset.id) save((s) => { s[t.dataset.id] = t.type === "checkbox" ? t.checked : t.value; }, t.dataset.id);
  });
  box.addEventListener("change", (e) => { const t = e.target; if (t.tagName === "SELECT" && t.dataset.id) save((s) => { s[t.dataset.id] = t.value; }, t.dataset.id); });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-choice]");
    if (b) {
      const id = b.dataset.choice, k = Number(b.dataset.k);
      let val;
      save((s) => {
        if (b.dataset.multi) { const a = new Set(s[id] ?? []); a.has(k) ? a.delete(k) : a.add(k); s[id] = [...a].sort(); val = s[id]; }
        else { s[id] = s[id] === k && !b.dataset.tier ? null : k; val = s[id]; }
      }, id);
      box.querySelectorAll(`[data-choice="${CSS.escape(id)}"]`).forEach((x) => {
        const kk = Number(x.dataset.k);
        x.setAttribute("aria-pressed", String(Array.isArray(val) ? val.includes(kk) : val === kk));
      });
      if (b.dataset.tier) box.querySelectorAll(`[data-tier-of="${CSS.escape(id)}"]`).forEach((x) => { x.hidden = Number(x.dataset.k) !== val; });
      return;
    }
    if (e.target.closest("[data-sheet-save]")) return saveSheetImage(lesson);
    if (e.target.closest("[data-sheet-submit]")) {
      const left = sheetLeft(lesson);
      if (left.length && !confirm(`아직 비어 있는 곳이 있어요.\n${left.map((x) => `· ${x}`).join("\n")}\n\n그래도 선생님께 보낼까요?`)) return;
      return liveSync(lesson, true);
    }
    if (e.target.closest("[data-sheet-clear]")) {
      if (!confirm("이 차시 활동지에 쓴 내용을 모두 지울까요?")) return;
      const all = readJSON(SHEET_KEY); delete all[key]; writeJSON(SHEET_KEY, all);
      const fresh = document.createElement("div"); fresh.innerHTML = sheetHtml(lesson, { big: box.classList.contains("is-big") });
      box.replaceWith(fresh.firstElementChild); bindSheet(lesson, root);
    }
  });
  // 실시간 수업: 처음 한 번 보내고, 모둠 칸이 있으면 몇 초마다 같은 모둠 내용을 받아 옴
  if (LIVE.url && isStudent) {
    liveSync(lesson);
    clearInterval(bindSheet.poll);
    bindSheet.poll = setInterval(() => {
      if (!box.isConnected) { clearInterval(bindSheet.poll); return; }
      livePullGroup(lesson);
    }, 4000);
  }
}

/* ---------- 실시간 수업 (학생) ---------- */
function liveSoon(lesson, wait = 1500) {
  if (!LIVE.url || !isStudent) return;
  clearTimeout(liveSoon.t);
  liveSoon.t = setTimeout(() => liveSync(lesson), wait);
}

function liveChip(text, ok) {
  document.querySelectorAll("[data-live-chip]").forEach((c) => { c.textContent = text; c.classList.toggle("is-on", Boolean(ok)); });
}

function liveWho() {
  const me = readJSON(ME_KEY);
  const room = String(me.room ?? "").trim(), ban = String(me.ban ?? "").trim(), no = String(me.no ?? "").trim();
  return { me, room, ban, no, group: String(me.group ?? "").trim(), ready: Boolean(room && ban && no) };
}

// 내 활동지 전체와 모둠 칸 변경분을 서버에 보냄. submit이면 "제출"로 남김
async function liveSync(lesson, submit = false) {
  if (!LIVE.url || !isStudent) return;
  const w = liveWho();
  if (!w.ready) {
    liveChip(w.room ? "반·번호를 써요" : "참여 코드를 써요", false);
    if (submit) alert("선생님께 보내려면 반, 번호, 교실 링크 참여 코드를 먼저 써 주세요.");
    return;
  }
  const st = sheetState(lesson);
  const fields = {}; const gfields = {};
  Object.keys(st).forEach((id) => { if (id !== "_gt") fields[id] = st[id]; });
  Object.entries(st._gt ?? {}).forEach(([id, t]) => { if (isGroupPart(lesson, Number(id.match(/^p(\d+)\./)?.[1] ?? -1))) gfields[id] = { v: st[id] ?? null, t }; });
  try {
    liveChip("보내는 중…", true);
    const r = await liveCall({ action: "save", room: w.room, lesson: lesson.no, student: { ban: w.ban, no: w.no, group: w.group },
      fields, gfields, progress: sheetProgress(lesson, st), submit,
      summary: submit ? sheetAnswers(lesson, st).map((x) => `${x.q}: ${x.a || "-"}`).join("\n") : undefined });
    LIVE.connected = true;
    if (r.gfields) applyGroup(lesson, r.gfields);
    receivePoints(r.points);
    liveChip(r.submitted ? "제출함 ✓" : "선생님께 연결됨", true);
    if (submit) { alert("선생님께 제출했어요!"); earnSheetBadge(lesson); }
  } catch (err) {
    LIVE.connected = false;
    liveChip("연결 안 됨", false);
    if (submit) alert(`제출하지 못했어요. ${err.message}\n그림으로 저장해 두세요.`);
  }
}

async function livePullGroup(lesson) {
  const w = liveWho();
  if (!w.ready) return;
  const anyGroup = lesson.sheet.parts.some((p, pi) => isGroupPart(lesson, pi));
  try {
    const r = await liveCall({ action: "group", room: w.room, lesson: lesson.no, group: w.group, student: { ban: w.ban, no: w.no } });
    applyGroup(lesson, r.fields || {});
    receivePoints(r.points);
    // 선생님이 모둠 칸 설정을 바꿨으면 활동지 표시도 바꿈
    document.querySelectorAll(".sheet-part").forEach((sec) => {
      const pi = Number(sec.dataset.pi);
      if (sec.classList.contains("is-group") !== isGroupPart(lesson, pi)) rerenderPart(lesson, pi);
    });
    if (!anyGroup) return;
  } catch { /* 다음 차례에 다시 받아 옴 */ }
}

// 같은 모둠 친구가 쓴 모둠 칸 내용을 내 활동지에 넣음 (내가 지금 쓰고 있는 칸은 건드리지 않음)
function applyGroup(lesson, g) {
  const key = `${cid}/${lesson.no}`;
  const all = readJSON(SHEET_KEY); const st = all[key] = all[key] ?? {}; st._gt = st._gt ?? {};
  const changed = new Set();
  Object.entries(g).forEach(([id, x]) => {
    if (!x || typeof x !== "object") return;
    const pi = Number(id.match(/^p(\d+)\./)?.[1] ?? -1);
    if (!isGroupPart(lesson, pi)) return;
    if ((st._gt[id] ?? 0) >= Number(x.t)) return;
    st[id] = x.v; st._gt[id] = Number(x.t); changed.add(pi);
  });
  if (!changed.size) return;
  writeJSON(SHEET_KEY, all);
  changed.forEach((pi) => rerenderPart(lesson, pi));
  document.querySelectorAll(".sheet").forEach((b) => paintSheetProgress(lesson, b));
  liveSoon(lesson, 2500);   // 받은 모둠 칸까지 넣어 선생님 화면의 진행 표시를 맞춤
}

function rerenderPart(lesson, pi) {
  document.querySelectorAll(`.sheet-part[data-pi="${pi}"]`).forEach((sec) => {
    if (sec.contains(document.activeElement) && document.activeElement !== document.body) return;
    const prefix = sec.id.replace(/sheet-p\d+$/, "");
    const f = document.createElement("div");
    f.innerHTML = partHtml(lesson, lesson.sheet.parts[pi], pi, sheetState(lesson), { idPrefix: prefix });
    sec.replaceWith(f.firstElementChild);
  });
}

// 아직 안 쓴 칸 이름 목록 ("분류판 (2칸 남음)")
function sheetLeft(lesson) {
  return sheetProgress(lesson).map(([d, n], pi) => (d < n ? `${lesson.sheet.parts[pi].title} (${n - d}칸 남음)` : "")).filter(Boolean);
}

// 활동지 아래 진행 막대. 다 채우면 "선생님께 보내기"를 크게 알려 줌
function paintSheetProgress(lesson, box) {
  const el = box.querySelector("[data-sheet-progress]");
  if (!el) return;
  const pr = sheetProgress(lesson);
  const done = pr.reduce((a, [d]) => a + d, 0), total = pr.reduce((a, [, n]) => a + n, 0);
  const full = total > 0 && done === total;
  const live = Boolean(LIVE.url) && isStudent;
  el.classList.toggle("is-full", full);
  el.innerHTML = `
    <div class="sp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div>
    <p>${full
      ? `🎉 활동지를 다 채웠어요! ${live ? "아래 <b>선생님께 제출</b>을 눌러 보내요." : "그림으로 저장해 선생님께 보내요."}`
      : `${total}칸 중 <b>${done}</b>칸 썼어요.`}</p>`;
  box.querySelector("[data-sheet-submit]")?.classList.toggle("is-ready", full);
  box.querySelector("[data-sheet-save]")?.classList.toggle("is-ready", full && !live);
}

// 칸(문항)마다 썼는지 세어 [쓴 문항, 전체 문항]을 차시 칸(part)별로 돌려줌
function sheetProgress(lesson, st = sheetState(lesson)) {
  const has = (id) => Object.keys(st).some((k) => (k === id || k.startsWith(`${id}.`)) && k !== "_gt" && st[k] !== null && st[k] !== "" && st[k] !== false && !(Array.isArray(st[k]) && !st[k].length));
  return lesson.sheet.parts.map((p, pi) => {
    const items = p.items.map((it, ii) => ({ it, id: `p${pi}.${ii}` })).filter(({ it }) => it.type !== "info");
    return [items.filter(({ id }) => has(id)).length, items.length];
  });
}

// 활동지에 쓴 내용을 "질문 — 답" 목록으로 바꿈 (그림 저장용)
function sheetAnswers(lesson, st = sheetState(lesson)) {
  const out = [];
  const ans = (x) => (x === undefined || x === null || x === "" ? "" : String(x).trim());
  const walk = (it, id, pre) => {
    const label = pre ? `${pre} · ` : "";
    switch (it.type) {
      case "text": out.push({ q: label + it.label, a: ans(st[id]) }); break;
      case "fill": { let k = 0; out.push({ q: label + "빈칸 채우기", a: it.text.replace(/\{\}/g, () => `[${ans(st[`${id}.${k++}`]) || "    "}]`) }); break; }
      case "choice": {
        const s = st[id]; let a = it.multi ? (s ?? []).map((k) => it.options[k]).join(", ") : (s ?? null) !== null ? it.options[s] : "";
        if (it.other && ans(st[`${id}.other`])) a = [a, `그 밖에: ${ans(st[`${id}.other`])}`].filter(Boolean).join(", ");
        out.push({ q: label + it.label, a }); break;
      }
      case "cards": out.push({ q: label + it.label, a: st[id] != null ? it.options[st[id]]?.name ?? "" : "" }); break;
      case "scale": it.rows.forEach((r, ri) => out.push({ q: label + r, a: st[`${id}.${ri}`] != null ? it.options[st[`${id}.${ri}`]] : "" })); break;
      case "sort": it.bins.forEach((bn, bi) => out.push({ q: label + bn, a: it.cards.filter((c, k) => st[`${id}.${k}`] === bi).map((c) => c.name).join(", ") })); break;
      case "table": {
        const lines = it.rows.map((r, ri) => {
          if (r[0] === "예") return "";
          const cells = r.map((c, ci) => (typeof c === "string" ? null : (c.in === "check" ? (st[`${id}.${ri}.${ci}`] ? `${it.head[ci]} ✔` : "") : (ans(st[`${id}.${ri}.${ci}`]) ? `${it.head[ci]}: ${ans(st[`${id}.${ri}.${ci}`])}` : ""))));
          const head = typeof r[0] === "string" ? r[0] : "";
          const filled = cells.filter(Boolean);
          return filled.length ? `${head ? `${head} — ` : ""}${filled.join(" / ")}` : "";
        }).filter(Boolean);
        out.push({ q: label + (it.head.join(" · ")), a: lines.join("\n") }); break;
      }
      case "tier": {
        const k = st[id];
        if (k == null) { out.push({ q: label + it.label, a: "" }); break; }
        const t = it.tiers[k];
        t.items.forEach((x, j) => walk(x, `${id}.t${k}.${j}`, `${t.name}`));
        break;
      }
      default: break;
    }
  };
  lesson.sheet.parts.forEach((p, pi) => p.items.forEach((it, ii) => walk(it, `p${pi}.${ii}`, p.title)));
  return out;
}

async function saveSheetImage(lesson) {
  const me = readJSON(ME_KEY);
  const who = [me.ban && `6학년 ${me.ban}반`, me.group && `${me.group}모둠`, me.name].filter(Boolean).join(" ");
  await saveNotesImage(lesson, sheetAnswers(lesson), { title: `${lesson.title} — 활동지`, who, file: `활동지${me.name ? `_${me.name}` : ""}` });
  earnSheetBadge(lesson);
}

// 성장 MAP: 활동지를 그림으로 저장하면(= 활동지를 끝내 제출할 준비가 되면) 그 차시 배지를 줌 (학생용 화면만)
function earnSheetBadge(lesson) {
  if (!isStudent || !lesson.badge) return;
  const unit = units.find((u) => u.lessons.includes(lesson));
  if (!unit) return;
  const map = readEarned();
  const key = badgeKey(cid, unit, lesson);
  if (map[key]) return;
  map[key] = new Date().toISOString().slice(0, 10);
  if (!writeEarned(map)) return;
  celebrate(lesson);
  const head = document.querySelector(".lesson-title");
  head?.classList.remove("not-earned");
  if (head && !head.querySelector(".badge-note")) {
    head.querySelector("div")?.insertAdjacentHTML("beforeend", `<p class="badge-note is-done">배지를 모았어요. <a href="#/badges">내 배지 보기</a></p>`);
  }
  updateBadgeLink();
}

/* ---------- PPT 수업 모드: 슬라이드를 넘기다 활동지를 띄움 ---------- */
function openSlideMode(lesson, start = 0) {
  const s = lesson.slides;
  let cur = start, view = "slide", notes = false;
  const overlay = document.createElement("div");
  overlay.className = "slidemode";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", `${lesson.title} 수업 모드`);
  overlay.innerHTML = `
    <div class="sm-top">
      <p><span>${lesson.no}${LW()}</span> ${esc(lesson.title)}</p>
      <span class="sm-tools">
        <button type="button" class="sm-btn sm-video" hidden></button>
        ${lesson.sheet ? `<button type="button" class="sm-btn sm-sheet">활동지</button>` : ""}
        <a class="sm-btn sm-live" href="${homeHref()}/live/${lesson.no}" target="_blank" rel="noopener">실시간 현황</a>
        <button type="button" class="sm-btn sm-notes" aria-pressed="false">메모</button>
        <button type="button" class="sm-btn sm-full">전체 화면</button>
        <button class="cm-close" type="button" aria-label="수업 모드 닫기">${icon.close}</button>
      </span>
    </div>
    <div class="sm-body">
      <div class="sm-slide"><img alt="" width="1280" height="720"></div>
      <div class="sm-sheet-view" hidden></div>
      <div class="sm-video-view" hidden></div>
    </div>
    <div class="sm-note" hidden></div>
    <div class="cm-nav">
      <button type="button" data-move="-1" aria-label="이전 슬라이드">${icon.left}</button>
      <span class="cm-count" aria-live="polite"></span>
      <button type="button" data-move="1" aria-label="다음 슬라이드">${icon.right}</button>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("no-scroll");
  const img = overlay.querySelector(".sm-slide img");
  const sheetView = overlay.querySelector(".sm-sheet-view");
  const partsAt = (n) => (lesson.sheet?.parts ?? []).map((p, i) => ({ p, i })).filter(({ p }) => (p.slides ?? []).includes(n));
  // 다음 슬라이드 그림을 미리 받아 둠
  const pre = (k) => { if (k >= 1 && k <= s.count) { const im = new Image(); im.src = slideSrc(lesson, k); } };
  const paint = () => {
    img.src = slideSrc(lesson, cur + 1); img.alt = s.titles?.[cur] || `${cur + 1}번 슬라이드`;
    pre(cur + 2);
    overlay.querySelector(".cm-count").textContent = view === "slide" ? `${cur + 1} / ${s.count}` : view === "video" ? "영상" : "활동지";
    const vids = slideVideos(lesson, cur + 1);
    const vb = overlay.querySelector(".sm-video");
    vb.hidden = !vids.length && view !== "video";
    vb.textContent = view === "video" ? "PPT로 돌아가기" : vids.length ? `▶ 영상: ${vids[0].title}` : "";
    vb.classList.toggle("is-hot", vids.length > 0 && view === "slide");
    const vv = overlay.querySelector(".sm-video-view");
    vv.hidden = view !== "video";
    if (view !== "video") vv.innerHTML = "";
    const here = partsAt(cur + 1);
    const btn = overlay.querySelector(".sm-sheet");
    if (btn) {
      btn.classList.toggle("is-hot", here.length > 0 && view === "slide");
      btn.textContent = view === "sheet" ? "PPT로 돌아가기" : here.length ? `활동지: ${here[0].p.title}` : "활동지";
    }
    overlay.querySelector(".sm-slide").hidden = view !== "slide";
    if (view === "video" && !vv.innerHTML && vids[0]) vv.innerHTML = `<iframe src="${esc(ytEmbed(vids[0]))}" title="${esc(vids[0].title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    sheetView.hidden = view !== "sheet";
    const nt = overlay.querySelector(".sm-note");
    nt.hidden = !notes || view !== "slide"; nt.textContent = s.notes?.[cur] || "메모 없음";
  };
  const openSheet = () => {
    view = "sheet";
    sheetView.innerHTML = sheetHtml(lesson, { big: true });
    bindSheet(lesson, sheetView);
    paint();
    const here = partsAt(cur + 1);
    const target = here.length ? sheetView.querySelector(`#sheet-p${here[0].i}`) : null;
    if (target) target.scrollIntoView({ block: "start" }); else sheetView.scrollTop = 0;
  };
  const move = (d) => {
    if (view === "sheet" || view === "video") { view = "slide"; paint(); return; }
    cur = Math.max(0, Math.min(s.count - 1, cur + d)); paint();
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    overlay.remove(); document.body.classList.remove("no-scroll");
    // 수업 모드에서 쓴 활동지 내용을 차시 화면에도 반영
    const box = document.querySelector("#app .sheet");
    if (box) { const f = document.createElement("div"); f.innerHTML = sheetHtml(lesson); box.replaceWith(f.firstElementChild); bindSheet(lesson); }
  };
  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
    if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); move(1); }
    else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); move(-1); }
    else if (e.key === "Escape") close();
    else if (e.key === "w" || e.key === "W" || e.key === "ㅈ") { view === "sheet" ? (view = "slide", paint()) : openSheet(); }
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    const m = e.target.closest("[data-move]"); if (m) return move(Number(m.dataset.move));
    if (e.target.closest(".cm-close")) return close();
    if (e.target.closest(".sm-sheet")) return view === "sheet" ? (view = "slide", paint()) : openSheet();
    if (e.target.closest(".sm-video")) { view = view === "video" ? "slide" : "video"; return paint(); }
    if (e.target.closest(".sm-notes")) { notes = !notes; e.target.closest(".sm-notes").setAttribute("aria-pressed", String(notes)); return paint(); }
    if (e.target.closest(".sm-full")) { document.fullscreenElement ? document.exitFullscreen?.() : overlay.requestFullscreen?.().catch(() => {}); return; }
    // 슬라이드 오른쪽/왼쪽을 누르면 넘김
    if (e.target === img) { const r = img.getBoundingClientRect(); move(e.clientX > r.left + r.width / 3 ? 1 : -1); }
  });
  paint();
  overlay.querySelector(".cm-close").focus();
}

/* ---------- 실시간 현황 (선생님) ----------
   주소: #/c/{교재}/live/{차시}. 학생 입력을 몇 초마다 받아 와 칸별 진행·제출·모둠 내용을 보여 줌.
   모둠 활동 칸 설정(개인/모둠)을 바꾸면 학생 화면에 몇 초 안에 반영됨. */
function renderLive(no) {
  const lessons = allLessons().filter(({ lesson }) => lesson.sheet);
  const cur = lessons.find(({ lesson }) => String(lesson.no) === String(no)) ?? lessons[0];
  if (!cur) { app.innerHTML = `<p class="status">활동지가 있는 차시가 없어요.</p>`; return; }
  const { lesson } = cur;
  const saved = readJSON(LIVE_T_KEY);
  const studentUrl = (room) => `${location.origin}${location.pathname}?view=student${room ? `&room=${encodeURIComponent(room)}` : ""}${homeHref()}/lesson/${encodeURIComponent(cur.unit.id)}/${lesson.no}`;

  if (!LIVE.url) {
    app.innerHTML = `
      <nav class="crumb"><a href="${homeHref()}">${esc(course.title)}</a></nav>
      <section class="live-setup">
        <h1>실시간 현황</h1>
        <p>학생들이 활동지에 쓰는 내용을 선생님 화면에서 바로 보려면 실시간 수업 서버를 한 번 연결해야 해요.</p>
        <ol>
          <li>교실 링크에 성장 MAP 활동지 기능(<code>/api/snja</code>)을 배포해요.</li>
          <li>그 주소를 <code>data/site.json</code>의 <code>site.live.url</code>에 넣어요.</li>
        </ol>
        <p class="notes-help">연결 전에도 학생 활동지는 기기에 저장되고, "그림으로 저장"으로 모을 수 있어요.</p>
      </section>`;
    return;
  }

  app.innerHTML = `
    <nav class="crumb"><a href="${homeHref()}">${esc(course.title)}</a> <span>/</span> 실시간 현황</nav>
    <section class="live">
      <header class="live-head">
        <h1>실시간 현황</h1>
        <form class="live-login" autocomplete="off">
          <label>참여 코드 <input name="room" value="${esc(saved.room ?? "")}" required maxlength="6" placeholder="교실 링크 6자리"></label>
          <label>선생님 키 <input name="code" type="password" value="${esc(saved.code ?? "")}" required title="교실 링크 교사 화면의 '실시간 현황' 버튼으로 열면 자동으로 들어가요"></label>
          <button class="btn-primary" type="submit">연결</button>
          <span class="live-chip" data-dash-chip>연결 전</span>
        </form>
      </header>
      <nav class="live-lessons" aria-label="차시">${lessons.map(({ unit, lesson: l }) =>
        `<a href="${homeHref()}/live/${l.no}"${l === lesson ? ` aria-current="page"` : ""}>${l.no}${LW()}<small>${esc(l.title)}</small></a>`).join("")}</nav>
      <div class="live-grid">
        <div class="live-main">
          <div class="live-summary" data-summary></div>
          <div class="sh-scroll"><table class="live-table" data-table></table></div>
          <div class="live-groups" data-groups></div>
        </div>
        <aside class="live-side">
          <section class="live-box">
            <h2>학생 들어오는 곳</h2>
            <div class="live-qr" data-qr></div>
            <p class="qr-url" data-url></p>
            <button class="btn-primary" type="button" data-share>교실 링크로 학생에게 보내기</button>
            <p class="notes-help">학생은 반·번호·모둠만 쓰면 바로 연결돼요. 이름은 보내지 않아요.</p>
          </section>
          <section class="live-box">
            <h2>모둠 활동 칸 설정</h2>
            <p class="notes-help">모둠으로 바꾼 칸은 같은 모둠 학생끼리 함께 쓰고, 서로 쓴 내용이 몇 초 뒤 보여요.</p>
            <ul class="live-parts" data-parts></ul>
          </section>
          <section class="live-box">
            <button class="btn-primary" type="button" data-csv>${icon.download}이 차시 기록 CSV로 받기</button>
            <p class="notes-help">교실 링크에서 수업을 종료하면 활동지 기록도 함께 지워져요. 끝내기 전에 받아 두세요.</p>
            <button class="btn-ghost" type="button" data-reset>이 차시 실시간 기록 비우기</button>
          </section>
        </aside>
      </div>
      <dialog class="live-detail" data-detail></dialog>
    </section>`;
  document.title = `실시간 현황 · ${lesson.no}${LW()} · ${course.title}`;

  const form = app.querySelector(".live-login");
  const chip = app.querySelector("[data-dash-chip]");
  let data = null, timer = null;
  const cred = () => readJSON(LIVE_T_KEY);

  const paintLink = () => {
    const url = studentUrl(cred().room);
    app.querySelector("[data-url]").textContent = url.replace(/^https?:\/\//, "");
    const q = app.querySelector("[data-qr]");
    if (typeof window.qrcode === "function") { const qr = window.qrcode(0, "M"); qr.addData(url); qr.make(); q.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true, alt: "학생용 QR 코드" }); }
  };
  const groupParts = () => {
    const g = LIVE.config?.groupParts?.[String(lesson.no)];
    return Array.isArray(g) ? g : lesson.sheet.parts.map((p, pi) => (p.who === "모둠" ? pi : -1)).filter((x) => x >= 0);
  };
  const paintParts = () => {
    const gp = groupParts();
    app.querySelector("[data-parts]").innerHTML = lesson.sheet.parts.map((p, pi) => `
      <li><span>${esc(p.title)}</span>
        <span class="seg" role="group" aria-label="${esc(p.title)} 쓰는 방법">
          <button type="button" data-pi="${pi}" data-mode="0" aria-pressed="${!gp.includes(pi)}">개인</button>
          <button type="button" data-pi="${pi}" data-mode="1" aria-pressed="${gp.includes(pi)}">모둠</button>
        </span></li>`).join("");
  };
  const ago = (t) => { const s = Math.max(0, Math.round(((data?.now ?? Date.now()) - t) / 1000)); return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`; };
  const bar = ([d, n]) => `<span class="pbar" title="${d}/${n}"><i style="width:${n ? Math.round(d / n * 100) : 0}%"></i><b>${d}/${n}</b></span>`;
  const pts = course.points ?? [];
  const givenHere = (x) => (x.points ?? []).filter((g) => Number(g.lesson) === Number(lesson.no)).map((g) => g.point);
  const paint = () => {
    if (!data) return;
    const list = [...data.students].sort((a, b) => (Number(a.group) || 99) - (Number(b.group) || 99) || (Number(a.ban) - Number(b.ban)) || (Number(a.no) - Number(b.no)));
    const parts = lesson.sheet.parts;
    const subm = list.filter((x) => x.submitted).length;
    const active = list.filter((x) => (data.now - x.t) < 60000).length;
    app.querySelector("[data-summary]").innerHTML = `
      <span><b>${list.length}</b>명 들어옴</span><span><b>${active}</b>명 지금 쓰는 중</span><span><b>${subm}</b>명 제출</span>`;
    app.querySelector("[data-table]").innerHTML = list.length ? `
      <thead><tr><th>모둠</th><th>반-번호</th>${parts.map((p, pi) => `<th>${esc(p.title)}${groupParts().includes(pi) ? " <small>(모둠)</small>" : ""}</th>`).join("")}<th>마지막 입력</th><th>제출</th>${pts.length ? "<th>칭찬포인트</th>" : ""}</tr></thead>
      <tbody>${list.map((x) => `<tr data-sid="${esc(x.sid)}" tabindex="0">
        <td>${esc(x.group || "-")}</td><th scope="row">${esc(x.ban)}-${esc(x.no)}</th>
        ${parts.map((p, pi) => `<td>${bar(x.progress?.[pi] ?? [0, 0])}</td>`).join("")}
        <td class="${(data.now - x.t) < 60000 ? "is-live" : ""}">${ago(x.t)}</td>
        <td>${x.submitted ? `<span class="ok">제출 ✓</span>` : ""}</td>
        ${pts.length ? `<td class="pt-cell">${givenHere(x).map((g) => pointImg(pointById(g), "pt-mini")).join("")}${(() => { const rec = recommendPoints(lesson, x.fields || {}).filter((id) => !givenHere(x).includes(id)); return rec.length ? `<span class="pt-rec">추천 ${rec.length}</span>` : ""; })()}</td>` : ""}</tr>`).join("")}</tbody>`
      : `<caption class="status">아직 들어온 학생이 없어요. 오른쪽 주소나 QR로 학생 화면을 열게 해 주세요.</caption>`;
    const groups = Object.keys(data.groups ?? {}).sort((a, b) => Number(a) - Number(b));
    const gp = groupParts();
    app.querySelector("[data-groups]").innerHTML = (gp.length || pts.some((p) => p.group)) && groups.length ? `
      <h2>모둠이 함께 쓴 내용</h2>
      <div class="live-gcards">${groups.map((g) => {
        const st = {}; Object.entries(data.groups[g] ?? {}).forEach(([id, v]) => { st[id] = v.v; });
        const ans = sheetAnswers(lesson, st).filter((a) => gp.some((pi) => a.q.startsWith(parts[pi].title)));
        const members = list.filter((x) => x.group === g).map((x) => `${x.ban}-${x.no}`).join(", ");
        const gp2 = pts.filter((p) => p.group);
        const gbtn = gp2.length ? `<div class="pt-group">${gp2.map((p) => `<button type="button" class="pt-give-group" data-group="${esc(g)}" data-point="${esc(p.id)}">${pointImg(p, "pt-mini")}모둠 전체에 「${esc(p.name)}」</button>`).join("")}</div>` : "";
        return `<article class="live-gcard"><h3>${esc(g)}모둠 <small>${esc(members)}</small></h3>${gbtn}
          ${ans.length ? `<dl>${ans.map((a) => `<dt>${esc(a.q)}</dt><dd>${esc(a.a || "—")}</dd>`).join("")}</dl>` : `<p class="notes-help">아직 쓴 내용이 없어요.</p>`}</article>`;
      }).join("")}</div>` : "";
  };
  const showDetail = (sid) => {
    const x = data?.students.find((s) => s.sid === sid); if (!x) return;
    const d = app.querySelector("[data-detail]");
    const rec = recommendPoints(lesson, x.fields || {});
    const given = givenHere(x);
    d.innerHTML = `<header><h2>${esc(x.ban)}-${esc(x.no)} <small>${esc(x.group ? `${x.group}모둠` : "")}</small></h2>
      <button type="button" class="cm-close" data-close aria-label="닫기">${icon.close}</button></header>
      ${pts.length ? `<section class="pt-give"><h3>칭찬포인트 주기 <small>답을 확인하고 눌러요. 다시 누르면 거둬요.</small></h3>
        <div class="pt-buttons">${pts.map((p) => `<button type="button" class="pt-btn${rec.includes(p.id) ? " is-rec" : ""}" data-sid="${esc(x.sid)}" data-point="${esc(p.id)}" aria-pressed="${given.includes(p.id)}" title="${esc(course.pointRules?.[p.id]?.why || p.desc || "")}">
          ${pointImg(p)}<b>${esc(p.name)}</b>${rec.includes(p.id) ? `<span class="pt-rec">추천</span>` : ""}</button>`).join("")}</div></section>` : ""}
      <dl>${sheetAnswers(lesson, x.fields || {}).map((a) => `<dt>${esc(a.q)}</dt><dd>${esc(a.a || "—")}</dd>`).join("")}</dl>`;
    d.showModal?.();
  };
  const load = async () => {
    const c = cred(); if (!c.room || !c.code) return;
    try {
      data = await liveCall({ action: "dash", room: c.room, teacher: c.code, lesson: lesson.no });
      chip.textContent = "실시간 ●"; chip.classList.add("is-on");
      paint(); paintParts();
    } catch (err) { chip.textContent = err.message; chip.classList.remove("is-on"); }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form);
    writeJSON(LIVE_T_KEY, { room: String(f.get("room")).replace(/[^0-9A-Za-z]/g, "").slice(0, 6).toUpperCase(), code: String(f.get("code")).trim() });
    paintLink(); load();
  });
  app.querySelector("[data-parts]").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-pi]"); if (!b) return;
    const c = cred(); if (!c.room || !c.code) { alert("수업 코드와 선생님 코드로 먼저 연결해 주세요."); return; }
    const pi = Number(b.dataset.pi); const on = b.dataset.mode === "1";
    const set = new Set(groupParts()); on ? set.add(pi) : set.delete(pi);
    const gpAll = { ...(LIVE.config?.groupParts ?? {}), [String(lesson.no)]: [...set].sort() };
    try { await liveCall({ action: "config", room: c.room, teacher: c.code, config: { ...LIVE.config, groupParts: gpAll } }); paintParts(); paint(); }
    catch (err) { alert(err.message); }
  });
  app.querySelector("[data-table]").addEventListener("click", (e) => { const r = e.target.closest("tr[data-sid]"); if (r) showDetail(r.dataset.sid); });
  app.querySelector("[data-table]").addEventListener("keydown", (e) => { const r = e.target.closest("tr[data-sid]"); if (r && e.key === "Enter") showDetail(r.dataset.sid); });
  const givePoint = async (sids, point, on) => {
    const c = cred();
    try {
      const r = await liveCall({ action: "point", room: c.room, teacher: c.code, lesson: lesson.no, sids, point, on });
      Object.entries(r.points ?? {}).forEach(([sid, list]) => { const st = data?.students.find((s) => s.sid === sid); if (st) st.points = list; });
      paint(); return true;
    } catch (err) { alert(err.message); return false; }
  };
  app.querySelector("[data-detail]").addEventListener("click", async (e) => {
    const b = e.target.closest(".pt-btn");
    if (b) { const on = b.getAttribute("aria-pressed") !== "true"; if (await givePoint([b.dataset.sid], b.dataset.point, on)) b.setAttribute("aria-pressed", String(on)); return; }
    if (e.target.closest("[data-close]") || e.target.matches("dialog")) e.currentTarget.close();
  });
  app.querySelector("[data-groups]").addEventListener("click", async (e) => {
    const b = e.target.closest(".pt-give-group"); if (!b || !data) return;
    const sids = data.students.filter((s) => s.group === b.dataset.group).map((s) => s.sid);
    const p = pointById(b.dataset.point);
    if (sids.length && confirm(`${b.dataset.group}모둠 ${sids.length}명에게 「${p?.name}」를 줄까요?`)) givePoint(sids, b.dataset.point, true);
  });
  app.querySelector("[data-share]").addEventListener("click", async () => {
    const c = cred(); if (!c.room || !c.code) { alert("참여 코드와 선생님 키로 먼저 연결해 주세요."); return; }
    try { await liveCall({ action: "share", room: c.room, teacher: c.code, url: studentUrl(c.room), title: `${lesson.no}${LW()} ${lesson.title} 활동지` }); alert("교실 링크로 활동지 링크를 보냈어요. 학생 화면의 '선생님이 보낸 자료'에 보여요."); }
    catch (err) { alert(err.message); }
  });
  app.querySelector("[data-csv]").addEventListener("click", () => {
    if (!data?.students?.length) { alert("아직 받을 기록이 없어요."); return; }
    // 학생마다 고른 과제(보충·기본·심화)가 달라 문항이 다를 수 있어 모든 문항을 모아 열을 만듦
    const per = data.students.map((x) => ({ x, ans: new Map(sheetAnswers(lesson, x.fields || {}).map((a) => [a.q, a.a])) }));
    const qs = [];
    per.forEach(({ ans }) => ans.forEach((_, q) => { if (!qs.includes(q)) qs.push(q); }));
    const rows = [["반", "번호", "모둠", "제출", ...(pts.length ? ["칭찬포인트(이 차시)"] : []), ...qs]];
    per.forEach(({ x, ans }) => rows.push([x.ban, x.no, x.group, x.submitted ? new Date(x.submitted).toLocaleString("ko-KR") : "",
      ...(pts.length ? [givenHere(x).map((g) => pointById(g)?.name ?? g).join(", ")] : []), ...qs.map((q) => ans.get(q) ?? "")]));
    const csv = "\ufeff" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${course.title}_${lesson.no}${LW()}_활동지_${cred().room}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  });
  app.querySelector("[data-reset]").addEventListener("click", async () => {
    const c = cred(); if (!c.room || !c.code) return;
    if (!confirm(`${lesson.no}${LW()} 실시간 기록을 비울까요? 학생 기기에 쓴 내용은 그대로 남아요.`)) return;
    try { await liveCall({ action: "reset", room: c.room, teacher: c.code, lesson: lesson.no }); load(); } catch (err) { alert(err.message); }
  });
  paintLink(); paintParts();
  load();
  timer = setInterval(() => { if (!document.body.contains(form)) { clearInterval(timer); return; } load(); }, 5000);
}

/* ---------- 칭찬포인트 (선생님이 실시간 현황에서 줌) ----------
   course.points: [{id, name, desc, img, group}]  course.pointRules: 추천 기준 (선생님 판단을 돕는 표시일 뿐 자동으로 주지 않음) */
const POINTS_KEY = "snja-points-v1";
const pointById = (id) => (course.points ?? []).find((p) => p.id === id);
const filled = (v) => !(v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length));
// 문장을 끝까지 완성했는지: 10자 이상이고 "~다/~요/~까" 같은 끝맺음으로 끝남
const isSentence = (v) => typeof v === "string" && v.trim().length >= 10 && /(다|요|죠|까|네)\s*[.!?~]*$/.test(v.trim());

// 활동지의 모든 칸을 [{id, item}]로 펼침 (보충·기본·심화 안의 칸 포함)
function sheetItems(lesson) {
  const out = [];
  const walk = (it, id) => {
    out.push({ id, item: it });
    if (it.type === "tier") it.tiers.forEach((t, k) => t.items.forEach((x, j) => walk(x, `${id}.t${k}.${j}`)));
  };
  (lesson.sheet?.parts ?? []).forEach((p, pi) => p.items.forEach((it, ii) => walk(it, `p${pi}.${ii}`)));
  return out;
}

function recommendPoints(lesson, f = {}) {
  const rules = course.pointRules ?? {};
  const out = [];
  Object.entries(rules).forEach(([id, r]) => {
    if (r.lessons && !r.lessons.includes(lesson.no)) return;
    let ok = false;
    if (r.type === "originTable") {
      for (let row = 1; row <= 9 && !ok; row++) ok = filled(f[`${r.id}.${row}.2`]) && (Boolean(f[`${r.id}.${row}.3`]) !== Boolean(f[`${r.id}.${row}.4`]));
    } else if (r.type === "allFilled") ok = r.ids.every((x) => filled(f[x]));
    else if (r.type === "sentenceAny") ok = r.ids.some((x) => isSentence(f[x]));
    else if (r.type === "reasonSentence") {
      ok = sheetItems(lesson).some(({ id: x, item }) => {
        if (item.type === "text" && /까닭|이유|왜|근거|추측/.test(item.label)) return isSentence(f[x]);
        if (item.type === "fill" && /왜냐하면/.test(item.text)) {
          const n = (item.text.match(/\{\}/g) || []).length;
          const blanks = Array.from({ length: n }, (_, k) => String(f[`${x}.${k}`] ?? "").trim());
          return blanks.every(Boolean) && blanks[blanks.length - 1].length >= 5;
        }
        return false;
      });
    }
    if (ok) out.push(id);
  });
  return out;
}

const pointImg = (p, cls = "pt-img") => p?.img ? `<img class="${cls}" src="${esc(p.img)}" alt="" loading="lazy">` : "";

// 학생: 서버에서 받은 내 칭찬포인트를 기기에 모으고, 새로 받은 것은 알려 줌
function receivePoints(list) {
  if (!Array.isArray(list) || !(course.points ?? []).length) return;
  const all = readJSON(POINTS_KEY); const key = cid;
  const before = new Set((all[key] ?? []).map((x) => `${x.point}/${x.lesson}`));
  all[key] = list; writeJSON(POINTS_KEY, all);
  const fresh = list.filter((x) => !before.has(`${x.point}/${x.lesson}`));
  paintMyPoints();
  if (fresh.length && before.size + fresh.length > 0) {
    const p = pointById(fresh[fresh.length - 1].point);
    if (p) pointToast(p);
  }
}

function pointToast(p) {
  document.querySelector(".badge-toast")?.remove();
  const t = document.createElement("div");
  t.className = "badge-toast";
  t.setAttribute("role", "status");
  t.innerHTML = `${pointImg(p, "toast-badge")}<p><b>칭찬포인트 「${esc(p.name)}」를 받았어요!</b><span>${esc(p.desc || "")}</span></p>
    <button type="button" aria-label="닫기">${icon.close}</button>`;
  t.querySelector("button").addEventListener("click", () => t.remove());
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("is-in"));
  setTimeout(() => t.remove(), 7000);
}

function paintMyPoints() {
  if (!isStudent) return;
  const mine = readJSON(POINTS_KEY)[cid] ?? [];
  document.querySelectorAll("[data-my-points]").forEach((el) => {
    el.hidden = !mine.length;
    el.innerHTML = mine.length ? `<span class="mp-label">내가 받은 칭찬포인트</span>${mine.map((x) => {
      const p = pointById(x.point); return p ? `<span class="mp-item" title="${esc(p.name)} · ${x.lesson}${LW()}">${pointImg(p)}<small>${esc(p.name)}</small></span>` : "";
    }).join("")}` : "";
  });
}
