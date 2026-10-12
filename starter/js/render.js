import { state, visibleStalls } from "./state.js";
import { describe } from "./api.js";

const template = document.querySelector("#stall-template");
const list = document.querySelector(".vendor-list");
const filters = document.querySelector(".filters"); // module scope: main.js has its own
const count = document.querySelector(".filter-count");
const savedCount = document.querySelector(".saved-count");
const search = document.querySelector("#vendor-search");
const errorMessage = document.querySelector(".load-error p");
const retry = document.querySelector(".load-error button");

// "★ 4.7 · 3 reviews", or "no reviews yet"
function rating(stall) {
  if (!stall.reviewCount) return "no reviews yet";
  const reviews = stall.reviewCount === 1 ? "review" : "reviews";
  return `★ ${stall.rating.toFixed(1)} · ${stall.reviewCount} ${reviews}`;
}

// Data in, element out
function card(stall) {
  const li = template.content.firstElementChild.cloneNode(true);
  li.dataset.id = stall.id;
  li.dataset.tag = stall.tag;

  const article = li.querySelector(".vendor-card");
  article.classList.toggle("featured", Boolean(stall.featured));
  article.classList.toggle("sold-out", Boolean(stall.soldOut)); // Boolean: a missing key is undefined, and toggle(name, undefined) flips

  li.querySelector(".tag").textContent = stall.tag;
  li.querySelector("h3").textContent = stall.name;
  li.querySelector(".blurb").textContent = stall.blurb;
  li.querySelector(".price").textContent = stall.price === 0 ? "free" : `from €${stall.price}`;
  li.querySelector(".rating").textContent = rating(stall);
  li.querySelector(".badge").hidden = !stall.soldOut;

  const isSaved = state.saved.has(stall.id);
  const save = li.querySelector(".save");
  save.setAttribute("aria-pressed", String(isSaved));
  save.setAttribute("aria-label", `Save ${stall.name}`);
  save.textContent = isSaved ? "♥" : "♡";

  li.querySelector(".open-reviews").setAttribute("aria-label", `Reviews of ${stall.name}`);
  return li;
}

function message(text) {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = text; // textContent: their words stay text
  return li;
}

function drawList(visible) {
  if (state.status === "loading") return list.replaceChildren(message("Loading the vendors…"));
  if (state.status === "error") return list.replaceChildren();
  if (visible.length) return list.replaceChildren(...visible.map(card));
  if (!state.stalls.length) return list.replaceChildren(message("No stalls at the market yet."));
  if (state.query.trim()) return list.replaceChildren(message(`No stall matches “${state.query}”.`));
  list.replaceChildren(message("No stalls in this category yet."));
}

function statusLine(visible) {
  if (state.status === "loading") return "Loading the vendors…";
  if (state.status === "error") return "The vendors didn't load.";
  const total = state.stalls.length;
  const stalls = total === 1 ? "stall" : "stalls";
  return visible.length === total ? `${total} ${stalls}` : `${visible.length} of ${total} ${stalls}`;
}

// Draws everything that depends on state. Safe to call any number of times.
export function render() {
  const visible = visibleStalls();

  list.setAttribute("aria-busy", String(state.status === "loading"));
  drawList(visible);

  // The alert stays on the page, so its text is announced when it changes
  errorMessage.textContent = state.status === "error"
    ? `Couldn't load the vendors: ${describe(state.error)}.`
    : "";
  retry.hidden = state.status !== "error";

  for (const button of filters.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.filter === state.tag));
  }
  count.textContent = statusLine(visible);
  savedCount.textContent = state.saved.size ? `♥ ${state.saved.size} saved` : "";

  // Controls are part of the page too: draw them from state
  // (only when different: rewriting the box you're typing in can move the cursor)
  if (search.value !== state.query) search.value = state.query;
}
