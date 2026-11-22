"use strict";

// Both pages live at the repository root, including on GitHub Pages.
const siteRoot = new URL("./", window.location.href);

function imagePageNumber(path, number) {
  if (typeof path !== "string") return null;
  const match = path.match(/^comics\/(\d{3,})\/(\d{3,})-([1-9]\d*)\.(?:webp|png|jpe?g)$/i);
  if (!match || match[1] !== number || match[2] !== number) return null;
  const page = Number(match[3]);
  return Number.isSafeInteger(page) ? page : null;
}

async function loadComics() {
  const response = await fetch(new URL("data/comics.json", siteRoot), { cache: "no-cache" });
  if (!response.ok) throw new Error("作品データを取得できませんでした。");
  const comics = await response.json();
  const numbers = new Set();
  if (!Array.isArray(comics)) throw new Error("作品データは配列にしてください。");
  for (const comic of comics) {
    if (!comic || typeof comic.number !== "string" || !/^\d{3,}$/.test(comic.number) ||
        !Number.isSafeInteger(Number(comic.number)) || Number(comic.number) < 1 ||
        numbers.has(Number(comic.number)) || typeof comic.title !== "string" || !comic.title.trim() ||
        !Array.isArray(comic.images) || comic.images.length === 0) {
      throw new Error("作品番号・タイトル・画像パスを確認してください。");
    }
    const pages = comic.images.map(path => imagePageNumber(path, comic.number));
    if (pages.includes(null) || new Set(pages).size !== pages.length) {
      throw new Error("画像は「comics/001/001-1.webp」の形式で、枝番を重複させずに登録してください。");
    }
    // Numeric order also keeps page 2 before page 10 if JSON is entered out of order.
    comic.images.sort((a, b) => imagePageNumber(a, comic.number) - imagePageNumber(b, comic.number));
    numbers.add(Number(comic.number));
  }
  return comics.sort((a, b) => Number(b.number) - Number(a.number));
}

function comicURL(comic) {
  const url = new URL("comic.html", siteRoot);
  url.searchParams.set("id", comic.number);
  return url.href;
}

function createImage(comic, path, thumbnail = false, pageIndex = 0) {
  const wrapper = document.createElement("div");
  const message = document.createElement("p");
  message.className = "image-status";
  message.textContent = "画像を読み込んでいます";
  const img = document.createElement("img");
  img.alt = thumbnail ? "" : (comic.alt || `第${comic.number}話「${comic.title}」の漫画`);
  if (!thumbnail && comic.images.length > 1) img.alt += `（${pageIndex + 1}/${comic.images.length}ページ）`;
  img.loading = thumbnail ? "lazy" : "eager";
  img.decoding = "async";
  // Lazy images need a visible layout box to enter the loading viewport.
  img.hidden = !thumbnail;
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
  img.src = new URL(path, siteRoot).href;
  return wrapper;
}

function renderArchive(comics) {
  const list = document.getElementById("comic-list");
  for (const comic of comics) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "comic-card";
    link.href = comicURL(comic);
    const thumbnail = createImage(comic, comic.images[0], true);
    thumbnail.className = "thumbnail";
    thumbnail.setAttribute("aria-hidden", "true");
    const number = document.createElement("span");
    number.className = "card-number";
    number.textContent = comic.number;
    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = comic.title;
    link.append(thumbnail, number, title);
    item.append(link);
    list.append(item);
  }
  setStatus(comics.length ? "" : "おはなしは、ただいま準備中です。");
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
  title.textContent = `${comic.number} ${comic.title}`;
  link.append(caption, title);
  document.getElementById(target).append(link);
}

function renderComic(comics) {
  const id = new URLSearchParams(window.location.search).get("id");
  const index = comics.findIndex(comic => comic.number === id);
  if (index === -1) {
    document.title = "おはなしが見つかりません | こくものまいにち";
    setStatus("おはなしが見つかりませんでした。作品一覧からお選びください。");
    return;
  }
  const comic = comics[index];
  document.title = `${comic.number} ${comic.title} | こくものまいにち`;
  document.getElementById("comic-number").textContent = comic.number;
  document.getElementById("comic-title").textContent = comic.title;
  const images = document.getElementById("comic-image");
  comic.images.forEach((path, pageIndex) => {
    const page = createImage(comic, path, false, pageIndex);
    page.className = "comic-page";
    images.append(page);
  });
  // Newest first: previous is older; next is newer.
  neighbor("previous-story", comics[index + 1], "前のおはなし", "prev");
  neighbor("next-story", comics[index - 1], "次のおはなし", "next");
  if (comics.length < 2) document.querySelector(".story-nav").hidden = true;
  document.getElementById("comic").hidden = false;
  setStatus("");
}

function setStatus(message) {
  const status = document.getElementById("page-status");
  status.textContent = message;
  status.hidden = !message;
}

loadComics().then(comics => {
  if (document.body.dataset.page === "comic") renderComic(comics);
  else renderArchive(comics);
}).catch(error => {
  console.error(error);
  setStatus("おはなしを読み込めませんでした。時間をおいて、ページを再読み込みしてください。");
});
