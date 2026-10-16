// Issue #1 · Reviews: read, post and delete a stall's reviews in a dialog.
// Every request goes through api.js; paths are relative to /api.
import { getJSON, postJSON, request, HttpError, describe } from "./api.js";
import { state } from "./state.js";
import { render } from "./render.js";

const list = document.querySelector(".vendor-list");
const dialog = document.querySelector(".reviews-dialog");
const title = dialog.querySelector("#reviews-title");
const closeButton = dialog.querySelector(".reviews-close");
const statusLine = dialog.querySelector(".reviews-status");
const errorMessage = dialog.querySelector(".reviews-error p");
const retry = dialog.querySelector(".reviews-error button");
const reviewList = dialog.querySelector(".reviews-list");
const form = dialog.querySelector(".review-form");
const formError = form.querySelector(".form-error");
const submit = form.querySelector('[type="submit"]');

// The reviews of the stall in the dialog, and what's in flight
const reviews = {
  stallId: null,
  status: "loading", // "loading" | "ready" | "error"
  error: null,
  items: [],         // newest first, as the server sends them
  posting: false,
  deleting: new Set(), // ids of the reviews being deleted
  notice: "",        // what the last post or delete did
};
let controller = null; // aborts the load of a stall nobody is looking at any more

// Reviews posted from this browser: only these can be deleted, also after a reload
const MINE = "harbour-my-reviews";
const mine = new Set(readMine());

function readMine() {
  try {
    const ids = JSON.parse(localStorage.getItem(MINE));
    return Array.isArray(ids) ? ids : [];
  } catch {
    return []; // broken or old data: nothing is mine
  }
}

function saveMine() {
  localStorage.setItem(MINE, JSON.stringify([...mine]));
}

const stallOf = (id) => state.stalls.find((stall) => stall.id === id);
const path = (id) => `/stalls/${encodeURIComponent(id)}`;

// ---------- drawing ----------

function stars(rating) {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function item(review) {
  const li = document.createElement("li");
  li.className = "review";

  const head = document.createElement("p");
  head.className = "review-head";
  const author = document.createElement("strong");
  author.textContent = review.author; // textContent: their words stay text, HTML too
  const rating = document.createElement("span");
  rating.className = "review-stars";
  rating.textContent = stars(review.rating);
  rating.setAttribute("aria-label", `${review.rating} out of 5`);
  rating.setAttribute("role", "img");
  const date = document.createElement("time");
  date.dateTime = review.createdAt;
  date.textContent = new Date(review.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  head.append(author, rating, date);

  const text = document.createElement("p");
  text.className = "review-text";
  text.textContent = review.text;
  li.append(head, text);

  if (mine.has(review.id)) {
    const isDeleting = reviews.deleting.has(review.id);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "review-delete";
    remove.dataset.id = review.id;
    remove.disabled = isDeleting;
    remove.textContent = isDeleting ? "Deleting…" : "Delete";
    remove.setAttribute("aria-label", `Delete your review, “${review.text.slice(0, 40)}”`);
    li.append(remove);
  }
  return li;
}

function statusText() {
  if (reviews.status === "loading") return "Loading the reviews…";
  if (reviews.status === "error") return "The reviews didn't load.";
  const count = reviews.items.length;
  if (!count) return "No reviews yet: be the first.";
  return `${count} ${count === 1 ? "review" : "reviews"}, newest first.`;
}

// Draws the dialog from `reviews`. Safe to call any number of times.
function draw() {
  const stall = stallOf(reviews.stallId);
  title.textContent = stall ? `Reviews · ${stall.name}` : "Reviews";

  statusLine.textContent = [statusText(), reviews.notice].filter(Boolean).join(" ");
  reviewList.setAttribute("aria-busy", String(reviews.status === "loading"));
  reviewList.replaceChildren(...(reviews.status === "ready" ? reviews.items.map(item) : []));

  errorMessage.textContent = reviews.status === "error"
    ? `Couldn't load the reviews: ${describe(reviews.error)}.`
    : "";
  retry.hidden = reviews.status !== "error";

  submit.disabled = reviews.posting;
  submit.textContent = reviews.posting ? "Posting…" : "Post review";
}

// ---------- the form's field messages ----------

function clearFieldErrors() {
  for (const field of form.querySelectorAll("[aria-invalid]")) field.removeAttribute("aria-invalid");
  for (const message of form.querySelectorAll(".field-error")) message.textContent = "";
  formError.textContent = "";
}

// 422: { fields: { author: "…", text: "…" } } → each message under its field
function showFieldErrors(fields) {
  let first = null;
  for (const [name, message] of Object.entries(fields)) {
    const field = form.elements[name];
    if (!field) continue;
    field.setAttribute("aria-invalid", "true");
    form.querySelector(`#review-${name}-error`).textContent = message;
    first ??= field;
  }
  first?.focus();
}

// ---------- the cards ----------

// The card's rating, worked out like the server does: average, one decimal
function countFromList(id) {
  const stall = stallOf(id);
  if (!stall || reviews.stallId !== id || reviews.status !== "ready") return;
  const count = reviews.items.length;
  const sum = reviews.items.reduce((total, review) => total + review.rating, 0);
  stall.reviewCount = count;
  stall.rating = count ? Math.round((sum / count) * 10) / 10 : null;
  render();
}

// Then the server's own numbers (GET /stalls/:id), unless a newer refresh started
let refreshes = 0;
async function refreshStall(id) {
  countFromList(id);
  const ticket = ++refreshes;
  try {
    const fresh = await getJSON(path(id));
    if (ticket !== refreshes) return;
    const index = state.stalls.findIndex((stall) => stall.id === id);
    if (index !== -1) state.stalls[index] = fresh;
    render();
  } catch (error) {
    console.error(error); // the card keeps the numbers from the list
  }
}

// ---------- requests ----------

async function loadReviews() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const id = reviews.stallId;

  reviews.status = "loading";
  reviews.error = null;
  reviews.items = [];
  draw();
  try {
    const items = await getJSON(`${path(id)}/reviews`, { signal });
    if (id !== reviews.stallId) return; // another stall is open now
    reviews.items = items;
    reviews.status = "ready";
  } catch (error) {
    if (error.name === "AbortError" || id !== reviews.stallId) return;
    console.error(error);
    reviews.error = error;
    reviews.status = "error";
  }
  draw();
}

async function postReview() {
  if (reviews.posting) return; // one at a time: no double posts
  const id = reviews.stallId;
  const data = {
    author: form.elements.author.value,
    rating: Number(form.elements.rating.value), // a number, not "5": the server is strict
    text: form.elements.text.value,
  };

  clearFieldErrors();
  reviews.notice = "";
  reviews.posting = true;
  draw();
  try {
    const review = await postJSON(`${path(id)}/reviews`, data);
    mine.add(review.id);
    saveMine();
    if (id === reviews.stallId) {
      reviews.notice = "Thanks, your review is up.";
      form.reset();
      // The list is on screen: add the review to it. It failed or is still
      // loading: load it again, and the new review comes with it.
      if (reviews.status === "ready") reviews.items.unshift(review);
      else loadReviews();
    }
    refreshStall(id);
  } catch (error) {
    console.error(error);
    if (id !== reviews.stallId) return;
    if (error instanceof HttpError && error.status === 422 && error.body?.fields) {
      showFieldErrors(error.body.fields);
    } else {
      // The form keeps its text: Post review again is all it takes
      formError.textContent = `Your review wasn't posted: ${describe(error)}. Try again.`;
    }
  } finally {
    reviews.posting = false;
    draw();
  }
}

async function deleteReview(reviewId) {
  if (reviews.deleting.has(reviewId)) return;
  const id = reviews.stallId;
  reviews.deleting.add(reviewId);
  reviews.notice = "";
  draw();
  try {
    await request("DELETE", `/reviews/${encodeURIComponent(reviewId)}`);
  } catch (error) {
    // 404: it's already gone, which is what we wanted
    if (!(error instanceof HttpError && error.status === 404)) {
      console.error(error);
      reviews.deleting.delete(reviewId);
      reviews.notice = `The review wasn't deleted: ${describe(error)}. Try again.`;
      draw();
      return;
    }
  }
  reviews.deleting.delete(reviewId);
  mine.delete(reviewId);
  saveMine();
  if (id === reviews.stallId) {
    reviews.items = reviews.items.filter((review) => review.id !== reviewId);
    reviews.notice = "Your review is deleted.";
    statusLine.focus(); // its Delete button is gone: keep focus in the dialog
  }
  draw();
  refreshStall(id);
}

// ---------- events ----------

function open(id) {
  if (id !== reviews.stallId) {
    form.reset(); // a draft belongs to the stall it was written for
    clearFieldErrors();
  }
  reviews.stallId = id;
  reviews.notice = "";
  dialog.showModal();
  loadReviews();
}

// Stop loading a stall nobody is looking at, and go back to its card's button
// (the cards may have been redrawn while the dialog was open: find it again)
function closed() {
  if (dialog.open) return; // another stall's reviews are open already
  controller?.abort();
  const stall = [...list.querySelectorAll(".stall")].find((li) => li.dataset.id === reviews.stallId);
  stall?.querySelector(".open-reviews").focus();
}

export function setupReviews() {
  list.addEventListener("click", (event) => {
    const button = event.target.closest(".open-reviews");
    if (button) open(button.closest(".stall").dataset.id);
  });

  closeButton.addEventListener("click", () => {
    dialog.close();
    closed();
  });
  // Esc and a click outside close it too; "close" arrives a task later
  dialog.addEventListener("close", closed);

  retry.addEventListener("click", () => {
    statusLine.focus();
    loadReviews();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    postReview();
  });

  // A field someone fixes stops being marked as wrong
  form.addEventListener("input", (event) => {
    if (!event.target.hasAttribute("aria-invalid")) return;
    event.target.removeAttribute("aria-invalid");
    form.querySelector(`#review-${event.target.name}-error`).textContent = "";
  });

  reviewList.addEventListener("click", (event) => {
    const button = event.target.closest(".review-delete");
    if (button) deleteReview(button.dataset.id);
  });
}
