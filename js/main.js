"use strict";

// Both pages live at the repository root, including on GitHub Pages.
const siteRoot = new URL("./", window.location.href);
const section = new URLSearchParams(window.location.search).get("section") === "memories" ? "memories" : "stories";
const collection = section === "memories"
  ? { folder: "memories", file: "memories.json", label: "思い出" }
  : { folder: "comics", file: "comics.json", label: "おはなし" };
const archiveURL = new URL("index.html", siteRoot);
if (section === "memories") archiveURL.searchParams.set("section", section);
document.body.dataset.section = section;

function metadata(record) {
  return section === "memories" ? record.date.replaceAll("-", ".") : record.number;
}

async function loadCollection() {
  const response = await fetch(new URL(`data/${collection.file}`, siteRoot), { cache: "no-cache" });
  if (!response.ok) throw new Error("作品データを取得できませんでした。");
  const comics = await response.json();
  if (!Array.isArray(comics)) throw new Error("作品データは配列にしてください。");
  for (const comic of comics) {
    if (!comic || typeof comic.id !== "string" || typeof comic.title !== "string" ||
        typeof comic[section === "memories" ? "date" : "number"] !== "string" ||
        !Array.isArray(comic.images) || !comic.images.length ||
        comic.images.some(path => typeof path !== "string" || !path.startsWith(`${collection.folder}/`))) {
      throw new Error("自動生成された作品データを確認してください。");
    }
  }
  // The build validates filenames and puts entries and pages in their display order.
  return comics;
}

function comicURL(comic) {
  const url = new URL("comic.html", siteRoot);
  url.searchParams.set("id", comic.id);
  if (section === "memories") url.searchParams.set("section", section);
  return url.href;
}

function createImage(comic, path, pageIndex = 0) {
  const wrapper = document.createElement("div");
  const message = document.createElement("p");
  message.className = "image-status";
  message.textContent = "画像を読み込んでいます";
  const img = document.createElement("img");
  img.alt = section === "memories" ? `${metadata(comic)}「${comic.title}」` : `第${comic.number}話「${comic.title}」の漫画`;
  if (comic.images.length > 1) img.alt += `（${pageIndex + 1}/${comic.images.length}ページ）`;
  img.loading = "eager";
  img.decoding = "async";
  img.hidden = true;
  img.style.opacity = "0";
  img.addEventListener("load", () => {
    message.remove();
    img.hidden = false;
    img.style.opacity = "1";
  }, { once: true });
  img.addEventListener("error", () => {
    img.remove();
    message.textContent = "画像を準備しています";
  }, { once: true });
  wrapper.append(message, img);
  // Encode each filename segment so Japanese titles, spaces, # and % stay filenames.
  img.src = new URL(path.split("/").map(encodeURIComponent).join("/"), siteRoot).href;
  return wrapper;
}

function appendCards(list, comics) {
  for (const comic of comics) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "comic-card";
    link.href = comicURL(comic);
    const number = document.createElement(section === "memories" ? "time" : "span");
    number.className = "card-number";
    number.textContent = metadata(comic);
    if (section === "memories") number.dateTime = comic.date;
    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = comic.title;
    link.append(number, title);
    item.append(link);
    list.append(item);
  }
}

function renderArchive(comics) {
  document.getElementById("archive-title").textContent = `${collection.label}一覧`;
  document.querySelector("#past-stories summary").textContent = `過去の${collection.label}`;
  document.querySelector(".skip-link").textContent = `${collection.label}一覧へ`;
  for (const link of document.querySelectorAll(".collection-switch a")) {
    if (link.dataset.section === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const batchSize = 8;
  appendCards(document.getElementById("comic-list"), comics.slice(0, batchSize));
  const past = document.getElementById("past-stories");
  const pastList = document.getElementById("past-comic-list");
  const more = document.getElementById("load-more");
  let shown = batchSize;

  function showMore(moveFocus = false) {
    const batch = comics.slice(shown, shown + batchSize);
    const firstNewIndex = pastList.children.length;
    appendCards(pastList, batch);
    shown += batch.length;
    more.hidden = shown >= comics.length;
    if (moveFocus) {
      document.getElementById("past-status").textContent = `${batch.length}作品を追加しました。全${comics.length}作品中${shown}作品を表示しています。`;
      pastList.children[firstNewIndex]?.querySelector("a").focus();
    }
  }

  past.hidden = comics.length <= batchSize;
  past.addEventListener("toggle", () => {
    if (past.open && pastList.children.length === 0) showMore();
  });
  more.addEventListener("click", () => showMore(true));
  setStatus(comics.length ? "" : `${collection.label}は、ただいま準備中です。`);
}

function neighbor(target, comic, label, relation) {
  if (!comic) return;
  const link = document.createElement("a");
  link.href = comicURL(comic);
  link.rel = relation;
  const caption = document.createElement("span");
  caption.textContent = label;
  const title = document.createElement("span");
  title.className = "neighbor-title";
  title.textContent = `${metadata(comic)} ${comic.title}`;
  link.append(caption, title);
  document.getElementById(target).append(link);
}

function renderComic(comics) {
  const back = document.querySelector(".back-link a");
  back.href = archiveURL.href;
  back.textContent = `${collection.label}一覧にもどる`;
  document.querySelector(".reader-header a").href = archiveURL.href;
  document.querySelector(".story-nav").setAttribute("aria-label", `${collection.label}の移動`);
  document.querySelector(".page-nav").setAttribute("aria-label", `この${collection.label}のページ`);
  const id = new URLSearchParams(window.location.search).get("id");
  const index = comics.findIndex(comic => comic.id === id);
  if (index === -1) {
    document.title = `${collection.label}が見つかりません | こくものまいにち`;
    setStatus(`${collection.label}が見つかりませんでした。一覧からお選びください。`);
    return;
  }
  const comic = comics[index];
  document.title = `${metadata(comic)} ${comic.title} | こくものまいにち`;
  document.getElementById("comic-number").textContent = metadata(comic);
  document.getElementById("comic-title").textContent = comic.title;
  const images = document.getElementById("comic-image");
  const previousPage = document.getElementById("previous-page");
  const nextPage = document.getElementById("next-page");
  const counter = document.getElementById("page-counter");
  let pageIndex = 0;

  function showPage() {
    const page = createImage(comic, comic.images[pageIndex], pageIndex);
    page.className = "comic-page";
    images.replaceChildren(page);
    counter.textContent = `${pageIndex + 1} / ${comic.images.length} ページ`;
    previousPage.disabled = pageIndex === 0;
    nextPage.disabled = pageIndex === comic.images.length - 1;
  }

  function turnPage(direction) {
    const nextIndex = pageIndex + direction;
    if (nextIndex < 0 || nextIndex >= comic.images.length) return;
    pageIndex = nextIndex;
    showPage();
    // Start the new page at its top when the reader has scrolled down.
    if (images.getBoundingClientRect().top < 0) images.scrollIntoView({ block: "start" });
  }

  previousPage.hidden = nextPage.hidden = comic.images.length === 1;
  previousPage.addEventListener("click", () => turnPage(-1));
  nextPage.addEventListener("click", () => turnPage(1));
  showPage();
  // Newest first: previous is older; next is newer.
  neighbor("previous-story", comics[index + 1], `前の${collection.label}`, "prev");
  neighbor("next-story", comics[index - 1], `次の${collection.label}`, "next");
  if (comics.length < 2) document.querySelector(".story-nav").hidden = true;
  document.getElementById("comic").hidden = false;
  setStatus("");
}

function setStatus(message) {
  const status = document.getElementById("page-status");
  status.textContent = message;
  status.hidden = !message;
}

loadCollection().then(comics => {
  if (document.body.dataset.page === "comic") renderComic(comics);
  else renderArchive(comics);
}).catch(error => {
  console.error(error);
  setStatus("作品を読み込めませんでした。時間をおいて、ページを再読み込みしてください。");
});
