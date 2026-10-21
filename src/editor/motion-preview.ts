/** Small, original offline demos teach interaction patterns without importing animation libraries. */
import type { MotionPreset } from "../motion";

type Preview = { element: HTMLElement; play?: () => void; label?: string; dispose?: () => void };
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function basic(motion: MotionPreset): Preview {
  const element = node("div", `motion-demo motion-demo-${motion.id}`); element.setAttribute("aria-hidden", "true");
  const targets = Array.from({ length: motion.id === "stagger" ? 3 : 1 }, (_, index) => {
    const target = node("div", "motion-sample", motion.id === "stagger" ? `Item ${index + 1}` : "Content"); element.append(target); return target;
  });
  let expanded = true;
  return { element, label: motion.id === "accordion" ? "Toggle preview" : "Play preview", play: () => {
    for (const [index, target] of targets.entries()) {
      target.getAnimations().forEach(animation => animation.cancel());
      const frames = motion.keyframes.map(frame => ({ ...frame }));
      if (motion.id === "accordion") { expanded = !expanded; if (!expanded) frames.reverse(); }
      target.animate(reduced() ? [frames.at(-1)!] : frames, { duration: reduced() ? 1 : motion.duration, easing: motion.easing, delay: !reduced() && motion.id === "stagger" ? index * 60 : 0, fill: "both" });
    }
  } };
}

function carousel(motion: MotionPreset): Preview {
  const element = node("div", `motion-widget preview-${motion.id}`);
  const stage = node("div", "preview-stage preview-carousel"); stage.tabIndex = 0; stage.setAttribute("role", "group"); stage.setAttribute("aria-label", `${motion.name}: drag horizontally or use arrow keys`);
  const track = node("div", "preview-track"); stage.append(track);
  const cards = Array.from({ length: 3 }, (_, index) => {
    const card = node("div", "preview-slide"); const poster = node("div", "preview-poster", `Slide ${index + 1}`);
    card.append(poster); track.append(card); return card;
  });
  const controls = node("div", "preview-controls");
  const previous = node("button", "", "Previous"), next = node("button", "", "Next");
  previous.setAttribute("aria-label", `${motion.name}: previous`); next.setAttribute("aria-label", `${motion.name}: next`);
  const status = node("span", "preview-status"); status.setAttribute("aria-live", "polite"); controls.append(previous, status, next);
  let index = 0, start: number | undefined;
  const draw = (delta = 0, immediate = false) => {
    element.dataset.index = String(index); element.style.setProperty("--preview-duration", immediate || reduced() ? "0ms" : `${motion.duration}ms`);
    track.style.transform = motion.id === "coverflow" ? "none" : `translateX(calc(${-index * 100}% + ${delta}px))`;
    for (const [i, card] of cards.entries()) {
      card.dataset.active = String(i === index);
      if (motion.id === "coverflow") {
        const offset = i - index;
        card.style.transform = `translateX(${offset * 82 + delta * .5}px) rotateY(${-offset * 35}deg) scale(${offset === 0 ? 1 : .82})`;
        card.style.zIndex = String(3 - Math.abs(offset)); card.style.opacity = Math.abs(offset) < 2 ? "1" : "0";
      } else if (motion.id === "carousel-parallax") {
        const shift = (index - i) * (stage.clientWidth || 260) * .35 - delta * .35;
        card.firstElementChild!.setAttribute("style", `transform:translateX(${shift}px)`);
      }
    }
    previous.disabled = index === 0; next.disabled = index === cards.length - 1;
    status.textContent = `${index + 1} / ${cards.length}`;
  };
  const step = (direction: number) => { index = Math.max(0, Math.min(cards.length - 1, index + direction)); draw(); };
  previous.addEventListener("click", () => step(-1)); next.addEventListener("click", () => step(1));
  stage.addEventListener("keydown", event => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); step(event.key === "ArrowLeft" ? -1 : 1); });
  stage.addEventListener("pointerdown", event => { if (event.button !== 0) return; start = event.clientX; stage.setPointerCapture(event.pointerId); stage.focus(); });
  stage.addEventListener("pointermove", event => { if (start !== undefined) draw(event.clientX - start, true); });
  stage.addEventListener("pointerup", event => {
    if (start === undefined) return;
    const delta = event.clientX - start; start = undefined;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (Math.abs(delta) > stage.clientWidth * .2) step(delta < 0 ? 1 : -1); else draw();
  });
  stage.addEventListener("pointercancel", () => { start = undefined; draw(); });
  element.append(stage, controls, node("small", "preview-help", "Drag the slides, or use Previous / Next.")); draw();
  return { element };
}

function scrollPattern(motion: MotionPreset): Preview {
  const element = node("div", `motion-widget preview-${motion.id}`);
  const stage = node("div", "preview-stage"); stage.setAttribute("aria-hidden", "true");
  let update: (progress: number) => void;
  if (motion.id === "horizontal-parallax") {
    const back = node("div", "preview-parallax-back", "Background · Background · Background");
    const front = node("div", "preview-parallax-front", "Foreground     A     B     C"); stage.append(back, front);
    update = p => { back.style.transform = `translateX(${-56 * p}px)`; front.style.transform = `translateX(${-160 * p}px)`; };
  } else if (motion.id === "horizontal-gallery") {
    const track = node("div", "preview-gallery-track"), pin = node("span", "preview-pin", "Pinned section");
    for (let i = 0; i < 3; i++) track.append(node("div", "preview-gallery-card", `Panel ${i + 1}`));
    stage.append(track, pin);
    update = p => { track.style.transform = `translateX(${-Math.max(0, track.scrollWidth - stage.clientWidth) * p}px)`; pin.textContent = p === 1 ? "Section released" : "Pinned section"; };
  } else if (motion.id === "scroll-stack") {
    const cards = Array.from({ length: 3 }, (_, i) => node("div", "preview-stack-card", `Card ${i + 1}`)); stage.append(...cards);
    update = p => cards.forEach((card, i) => {
      const arrival = i === 0 ? 1 : clamp(p * 2 - (i - 1));
      const recede = clamp(p * 2 - i);
      card.style.transform = `translateY(${(1 - arrival) * 115 + i * 10}px) scale(${1 - .1 * recede})`;
    });
  } else {
    const image = node("div", "preview-art"); image.append(node("strong", "", "Preview image"), node("span", "", "Original aspect ratio")); stage.append(image);
    update = motion.id === "scroll-reveal"
      ? p => { image.style.clipPath = `inset(0% ${45 * (1 - p)}% 0% ${45 * (1 - p)}%)`; }
      : p => { image.style.transform = `scale(${.78 + .22 * p})`; };
  }
  const label = node("label", "preview-progress-label", "Scroll progress ");
  const output = node("span", "", "0%"); const slider = node("input", "preview-progress"); slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.value = "0";
  slider.setAttribute("aria-label", `${motion.name}: scroll progress`); label.append(output, slider);
  slider.addEventListener("input", () => { const progress = Number(slider.value) / 100; output.textContent = `${slider.value}%`; element.dataset.progress = slider.value; update(progress); });
  element.append(stage, label, node("small", "preview-help", "Drag the slider to simulate section scrolling, in either direction."));
  if (reduced()) {
    element.dataset.reduced = "true"; slider.disabled = true; output.textContent = "Static · reduced motion";
  } else update(0);
  return { element };
}

function marquee(motion: MotionPreset): Preview {
  const element = node("div", "motion-widget preview-marquee"), stage = node("div", "preview-stage");
  const track = node("div", "preview-ticker-track");
  track.append(node("span", "preview-ticker-group", "Design · Build · Ship"), node("span", "preview-ticker-group", "Design · Build · Ship")); track.setAttribute("aria-hidden", "true"); stage.append(track);
  const button = node("button", "", "Play marquee"); button.setAttribute("aria-label", "Play marquee");
  let animation: Animation | undefined, playing = false;
  button.addEventListener("click", () => {
    if (reduced()) return;
    playing = !playing;
    if (playing) {
      animation ??= track.animate([{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }], { duration: motion.duration, iterations: Infinity, easing: "linear" });
      animation.play();
    } else animation?.pause();
    button.textContent = playing ? "Pause marquee" : "Play marquee"; button.setAttribute("aria-label", button.textContent);
  });
  stage.addEventListener("mouseenter", () => animation?.pause()); stage.addEventListener("mouseleave", () => { if (playing) animation?.play(); });
  stage.tabIndex = 0; stage.setAttribute("aria-label", "Marquee preview; focus pauses movement");
  stage.addEventListener("focus", () => animation?.pause()); stage.addEventListener("blur", () => { if (playing) animation?.play(); });
  if (reduced()) { button.disabled = true; button.textContent = "Static · reduced motion"; }
  element.append(stage, button, node("small", "preview-help", "An opt-in loop. Hover or focus the preview to pause.")); return { element, dispose: () => { playing = false; animation?.cancel(); } };
}

function swipeStack(motion: MotionPreset): Preview {
  const element = node("div", "motion-widget preview-swipe-stack"), stage = node("div", "preview-stage");
  stage.tabIndex = 0; stage.setAttribute("role", "group"); stage.setAttribute("aria-label", "Swipe card stack: drag the front card");
  const cards = Array.from({ length: 3 }, (_, i) => node("div", "preview-stack-card", `Card ${i + 1}`)); stage.append(...cards);
  const next = node("button", "", "Next card"), status = node("span", "preview-status"); status.setAttribute("aria-live", "polite");
  let index = 0, start: number | undefined, busy = false;
  const draw = (delta = 0) => {
    element.dataset.index = String(index);
    cards.forEach((card, i) => {
      const order = (i - index + 3) % 3;
      card.style.zIndex = String(3 - order); card.style.transform = `translate(${order === 0 ? delta : order * 5}px, ${order * 8}px) rotate(${order === 0 ? Math.max(-12, Math.min(12, delta / 10)) : 0}deg) scale(${1 - order * .06})`;
    }); status.textContent = `Card ${index + 1} / 3`;
  };
  const advance = (direction = 1) => {
    if (busy) return;
    if (reduced()) { index = (index + 1) % 3; draw(); return; }
    busy = true; const card = cards[index];
    const animation = card.animate([{ transform: card.style.transform }, { transform: `translateX(${direction * (stage.clientWidth + 60)}px) rotate(${direction * 12}deg)` }], { duration: motion.duration, easing: motion.easing });
    animation.finished.then(() => { index = (index + 1) % 3; busy = false; draw(); }, () => { busy = false; draw(); });
  };
  next.addEventListener("click", () => advance());
  stage.addEventListener("pointerdown", event => { if (event.button !== 0 || busy) return; start = event.clientX; stage.setPointerCapture(event.pointerId); stage.focus(); });
  stage.addEventListener("pointermove", event => { if (start !== undefined) draw(event.clientX - start); });
  stage.addEventListener("pointerup", event => { if (start === undefined) return; const delta = event.clientX - start; start = undefined; if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId); if (Math.abs(delta) > stage.clientWidth * .25) advance(delta < 0 ? -1 : 1); else draw(); });
  stage.addEventListener("pointercancel", () => { start = undefined; draw(); });
  const controls = node("div", "preview-controls"); controls.append(next, status); element.append(stage, controls); draw(); return { element };
}

function tabs(): Preview {
  const element = node("div", "motion-widget preview-sliding-tabs"), stage = node("div", "preview-stage"), tablist = node("div", "preview-tabs");
  tablist.setAttribute("role", "tablist"); tablist.setAttribute("aria-label", "Sliding indicator preview");
  const indicator = node("span", "preview-tab-indicator"); indicator.setAttribute("aria-hidden", "true");
  const panel = node("div", "preview-tab-panel"); panel.setAttribute("role", "tabpanel"); panel.id = `motion-panel-${crypto.randomUUID()}`;
  const buttons = ["Overview", "Details", "Activity"].map((label, i) => { const button = node("button", "", label); button.setAttribute("role", "tab"); button.id = `${panel.id}-${i}`; button.setAttribute("aria-controls", panel.id); tablist.append(button); return button; });
  const select = (index: number) => {
    element.dataset.index = String(index); indicator.style.left = `${[0, 29.4118, 70.5882][index]}%`; indicator.style.width = `${index === 1 ? 41.1764 : 29.4118}%`;
    buttons.forEach((button, i) => { button.setAttribute("aria-selected", String(i === index)); button.tabIndex = i === index ? 0 : -1; });
    panel.textContent = `${buttons[index].textContent} panel`; panel.setAttribute("aria-labelledby", buttons[index].id);
  };
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => select(index));
    button.addEventListener("keydown", event => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const target = (index + (event.key === "ArrowLeft" ? 2 : 1)) % 3; select(target); buttons[target].focus(); });
  });
  tablist.append(indicator); stage.append(tablist, panel); element.append(stage); select(0); return { element };
}

function expandingCard(): Preview {
  const element = node("div", "motion-widget preview-expanding-card"), stage = node("div", "preview-stage"), card = node("button", "preview-expand-card");
  const title = node("strong", "", "Project overview"), details = node("span", "", "Shared title and media stay connected as the card changes size."), hint = node("small", "", "Open details"); details.hidden = true;
  card.append(title, details, hint); let expanded = false;
  const toggle = () => { expanded = !expanded; card.setAttribute("aria-expanded", String(expanded)); element.dataset.expanded = String(expanded); details.hidden = !expanded; hint.textContent = expanded ? "Close details" : "Open details"; };
  card.setAttribute("aria-expanded", "false"); card.setAttribute("aria-label", "Toggle expanding card"); card.addEventListener("click", toggle);
  card.addEventListener("keydown", event => { if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); toggle(); card.focus(); } });
  stage.append(card); element.append(stage); return { element };
}

export function createMotionPreview(motion: MotionPreset): Preview {
  if (motion.category === "Basic") return basic(motion);
  if (motion.category === "Scroll") return scrollPattern(motion);
  if (["carousel", "carousel-parallax", "coverflow"].includes(motion.id)) return carousel(motion);
  if (motion.id === "marquee") return marquee(motion);
  if (motion.id === "swipe-stack") return swipeStack(motion);
  if (motion.id === "sliding-tabs") return tabs();
  return expandingCard();
}
