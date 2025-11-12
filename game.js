const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function makeDeck() {
  const d = [];
  for (const s of suits) for (const r of ranks) d.push({ r, s });
  // simple shuffle
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardValue(r) {
  if (r === "A") return 11;
  if (["K", "Q", "J"].includes(r)) return 10;
  return Number(r);
}

function handTotal(hand) {
  let total = hand.reduce((sum, c) => sum + cardValue(c.r), 0);
  let aces = hand.filter(c => c.r === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

// Map cards to Unicode Playing Cards block
function cardUnicode(c) {
  if (c.r === "?") return String.fromCodePoint(0x1F0A0); // 🂠 back
  const base = { "♠": 0x1F0A0, "♥": 0x1F0B0, "♦": 0x1F0C0, "♣": 0x1F0D0 }[c.s];
  let offset;
  if (c.r === "A") offset = 0x1;
  else if (c.r === "J") offset = 0xB;
  else if (c.r === "Q") offset = 0xD; // skip Knight (0xC)
  else if (c.r === "K") offset = 0xE;
  else offset = parseInt(c.r, 10); // 2..10 -> 0x2..0xA
  return String.fromCodePoint(base + offset);
}

const el = {
  dealerCards: document.getElementById("dealer-cards"),
  dealerTotal: document.getElementById("dealer-total"),
  playerCards: document.getElementById("player-cards"),
  playerTotal: document.getElementById("player-total"),
  hit: document.getElementById("hit"),
  stand: document.getElementById("stand"),
  newRound: document.getElementById("new-round"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  resultImg: document.getElementById("result-img"),
};

let state = {
  deck: [],
  dealer: [],
  player: [],
  dealerHidden: null,
  finished: false,
  wins: 0,
};

// token/wins removed — wins are still tracked in state but not displayed

const elWin = {
  wins: document.getElementById("wins"),
};

function updateWinsDisplay() {
  if (!elWin.wins) return;
  const count = Math.max(0, Number(state.wins || 0));
  const digits = String(count).split("");
  // clear current content
  elWin.wins.innerHTML = "";
  // create an image for each digit
  for (const d of digits) {
    const img = document.createElement("img");
    // use the digit GIFs (fallback to text if digit asset missing)
    img.src = `/${d}.gif`;
    img.alt = d;
    img.width = 20;
    img.height = 20;
    elWin.wins.appendChild(img);
  }
}

// FLIP helper: record positions before and animate to new positions
function flipAnimate(container, updateDom) {
  const before = Array.from(container.children).map(el => el.getBoundingClientRect());
  const beforeMap = new Map(Array.from(container.children).map((el, i) => [el, before[i]]));
  // run DOM updates synchronously
  updateDom();

  const afterChildren = Array.from(container.children);
  const afterRects = afterChildren.map(el => el.getBoundingClientRect());

  afterChildren.forEach((el, i) => {
    const prevRect = beforeMap.get(el);
    const newRect = afterRects[i];
    if (prevRect) {
      const dx = prevRect.left - newRect.left;
      const dy = prevRect.top - newRect.top;
      if (dx !== 0 || dy !== 0) {
        // apply inverse transform to start at previous position
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        // force reflow then remove transform to animate to natural position
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1)";
            el.style.transform = "";
          });
        });
        // cleanup after transition
        const onEnd = () => {
          el.style.transition = "";
          el.style.transform = "";
          el.removeEventListener("transitionend", onEnd);
        };
        el.addEventListener("transitionend", onEnd);
      }
    } else {
      // new element: subtle entrance so layout movement feels natural.
      el.style.transition = "none";
      el.style.transform = "translateY(-12px)";
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 220ms";
          el.style.transform = "";
          el.style.opacity = "1";
        });
      });
      const onEnd = () => {
        el.style.transition = "";
        el.style.opacity = "";
        el.style.transform = "";
        el.removeEventListener("transitionend", onEnd);
      };
      el.addEventListener("transitionend", onEnd);
    }
  });
}

function render() {
  // Reuse existing DOM nodes so only newly spawned cards animate.
  // Player cards
  flipAnimate(el.playerCards, () => {
    const playerDomCards = el.playerCards.children;
    // If DOM has more cards than state (shouldn't happen), clear and rebuild.
    if (playerDomCards.length > state.player.length) {
      el.playerCards.innerHTML = "";
    }
    // Add any missing player cards (only these will animate)
    for (let i = 0; i < state.player.length; i++) {
      if (!playerDomCards[i]) addCard(el.playerCards, state.player[i]);
    }
  });

  // Dealer cards
  flipAnimate(el.dealerCards, () => {
    const dealerDomCards = el.dealerCards.children;
    const showDealer = [...state.dealer];
    // If dealer has a hidden card and round not finished, the first DOM card should be the back.
    if (state.dealerHidden && !state.finished) {
      // ensure first DOM card is the back
      if (!dealerDomCards[0]) addCard(el.dealerCards, { r: "?", s: "" });
      // add remaining dealer cards if missing
      for (let i = 1; i < showDealer.length; i++) {
        if (!dealerDomCards[i]) addCard(el.dealerCards, showDealer[i]);
      }
    } else {
      // dealer fully revealed
      // If we previously rendered a back card in position 0, replace its content with the real card without reanimating.
      if (dealerDomCards[0] && dealerDomCards[0].querySelector && dealerDomCards[0].querySelector('img') && dealerDomCards[0].querySelector('img').getAttribute('alt') === 'card back') {
        // replace first card content synchronously and keep visible class if present
        const real = showDealer[0];
        // build content for first card (without triggering addCard animation)
        // ensure container exists and keep any classes
        dealerDomCards[0].classList.remove('visible'); // safe no-op if absent
        // create layered real image (hidden) and keep existing back image on top, then cross-fade
        dealerDomCards[0].innerHTML = '';
        // back image (visible initially)
        const backImg = document.createElement('img');
        backImg.src = '/back.gif';
        backImg.alt = 'card back';
        backImg.className = 'layered-img back';
        dealerDomCards[0].appendChild(backImg);
        // determine real file if possible
        if (real.r !== '?') {
          let file = null;
          if (real.s === '♣' || real.s === '♠' || real.s === '♦' || real.s === '♥') {
            const rankToFile = {
              "A": real.s === "♠" ? "/pinkaceofclovers.gif" : real.s === "♦" ? "/cyanaceofclovers.gif" : real.s === "♠" ? "/yellowaceofclovers.gif" : "/aceofclovers.gif",
              "2": real.s === "♠" ? "/pinktwoofclovers.gif" : real.s === "♦" ? "/cyantwoofclovers.gif" : "/twoofclovers.gif",
              "3": real.s === "♠" ? "/pinkthreeofclovers.gif" : real.s === "♦" ? "/cyanthreeofclovers.gif" : "/threeofclovers.gif",
              "4": real.s === "♠" ? "/pinkfourofclovers.gif" : real.s === "♦" ? "/cyanfourofclovers.gif" : "/fourofclovers.gif",
              "5": real.s === "♠" ? "/pinkfiveofclovers.gif" : real.s === "♦" ? "/cyanfiveofclovers.gif" : "/fiveofclovers.gif",
              "6": real.s === "♠" ? "/pinksixofclovers.gif" : real.s === "♦" ? "/cyansixofclovers.gif" : "/sixofclovers.gif",
              "7": real.s === "♠" ? "/pinksevenofclovers.gif" : real.s === "♦" ? "/cyansevenofclovers.gif" : "/sevenofclovers.gif",
              "8": real.s === "♠" ? "/pinkeightofclovers.gif" : real.s === "♦" ? "/cyaneightofclovers.gif" : "/eightofclovers.gif",
              "9": real.s === "♠" ? "/pinknineofclovers.gif" : real.s === "♦" ? "/cyannineofclovers.gif" : "/nineofclovers.gif",
              "10": real.s === "♠" ? "/pinktenofclovers.gif" : real.s === "♦" ? "/cyantenofclovers.gif" : "/tenofclovers.gif",
              "J": real.s === "♠" ? "/pinkjesterofclovers.gif" : real.s === "♦" ? "/cyanjesterofclovers.gif" : "/jesterofclovers.gif",
              "Q": real.s === "♠" ? "/pinkqueenofclovers.gif" : real.s === "♦" ? "/cyanqueenofclovers.gif" : "/queenofclovers.gif",
              "K": real.s === "♠" ? "/pinkkingofclovers.gif" : real.s === "♠" ? "/cyankingofclovers.gif" : "/kingofclovers.gif"
            };
            file = rankToFile[real.r];
          }
          if (file) {
            const realImg = document.createElement('img');
            realImg.src = file;
            realImg.alt = `${real.r} of ${real.s}`;
            realImg.className = 'layered-img real';
            dealerDomCards[0].appendChild(realImg);
            // wait for real to load (or error) then cross-fade: show real, fade out back, then remove back
            const onRealReady = () => {
              realImg.removeEventListener('load', onRealReady);
              realImg.removeEventListener('error', onRealReady);
              // force reflow then start cross-fade
              void realImg.offsetWidth;
              realImg.style.opacity = '1';
              backImg.style.opacity = '0';
              // remove back after transition completes
              const cleanup = () => {
                backImg.removeEventListener('transitionend', cleanup);
                if (backImg.parentNode) backImg.parentNode.removeChild(backImg);
              };
              backImg.addEventListener('transitionend', cleanup);
            };
            realImg.addEventListener('load', onRealReady);
            realImg.addEventListener('error', onRealReady);
            if (realImg.complete && realImg.naturalWidth !== 0) onRealReady();
          } else {
            // fallback: just show unicode immediately by replacing content
            dealerDomCards[0].textContent = cardUnicode(real);
          }
        } else {
          // if still a back, leave it
        }
      }
      // add any other missing dealer cards
      for (let i = 0; i < showDealer.length; i++) {
        if (!dealerDomCards[i]) addCard(el.dealerCards, showDealer[i]);
      }
    }
  });

  el.hit.disabled = state.finished;
  el.stand.disabled = state.finished;
  el.newRound.disabled = !state.finished;
  // no wins counter to update
}

function addCard(container, c) {
  const div = document.createElement("div");
  div.className = "card";
  if (c.r === "?") {
    const img = document.createElement("img");
    img.src = "/back.gif";
    img.alt = "card back";
    div.appendChild(img);
  } else if (c.s === "♣" || c.s === "♠" || c.s === "♦" || c.s === "♥") {
    // Use specific clover GIFs for club/spade/diamond/heart cards when available.
    // For spades (♠) use the pink variants; for diamonds (♦) use the cyan variants; for hearts (♥) use the yellow variants.
    const rankToFile = {
      "A": c.s === "♠" ? "/pinkaceofclovers.gif" : c.s === "♦" ? "/cyanaceofclovers.gif" : c.s === "♥" ? "/yellowaceofclovers.gif" : "/aceofclovers.gif",
      "2": c.s === "♠" ? "/pinktwoofclovers.gif" : c.s === "♦" ? "/cyantwoofclovers.gif" : c.s === "♥" ? "/yellowtwoofclovers.gif" : "/twoofclovers.gif",
      "3": c.s === "♠" ? "/pinkthreeofclovers.gif" : c.s === "♦" ? "/cyanthreeofclovers.gif" : c.s === "♥" ? "/yellowthreeofclovers.gif" : "/threeofclovers.gif",
      "4": c.s === "♠" ? "/pinkfourofclovers.gif" : c.s === "♦" ? "/cyanfourofclovers.gif" : c.s === "♥" ? "/yellowfourofclovers.gif" : "/fourofclovers.gif",
      "5": c.s === "♠" ? "/pinkfiveofclovers.gif" : c.s === "♦" ? "/cyanfiveofclovers.gif" : c.s === "♥" ? "/yellowfiveofclovers.gif" : "/fiveofclovers.gif",
      "6": c.s === "♠" ? "/pinksixofclovers.gif" : c.s === "♦" ? "/cyansixofclovers.gif" : c.s === "♥" ? "/yellowsixofclovers.gif" : "/sixofclovers.gif",
      "7": c.s === "♠" ? "/pinksevenofclovers.gif" : c.s === "♦" ? "/cyansevenofclovers.gif" : c.s === "♥" ? "/yellowsevenofclovers.gif" : "/sevenofclovers.gif",
      "8": c.s === "♠" ? "/pinkeightofclovers.gif" : c.s === "♦" ? "/cyaneightofclovers.gif" : c.s === "♥" ? "/yelloweightofclovers.gif" : "/eightofclovers.gif",
      "9": c.s === "♠" ? "/pinknineofclovers.gif" : c.s === "♦" ? "/cyannineofclovers.gif" : c.s === "♥" ? "/yellownineofclovers.gif" : "/nineofclovers.gif",
      "10": c.s === "♠" ? "/pinktenofclovers.gif" : c.s === "♦" ? "/cyantenofclovers.gif" : c.s === "♥" ? "/yellowtenofclovers.gif" : "/tenofclovers.gif",
      "J": c.s === "♠" ? "/pinkjesterofclovers.gif" : c.s === "♦" ? "/cyanjesterofclovers.gif" : c.s === "♥" ? "/yellowjesterofclovers.gif" : "/jesterofclovers.gif",
      "Q": c.s === "♠" ? "/pinkqueenofclovers.gif" : c.s === "♦" ? "/cyanqueenofclovers.gif" : c.s === "♥" ? "/yellowqueenofclovers.gif" : "/queenofclovers.gif",
      "K": c.s === "♠" ? "/pinkkingofclovers.gif" : c.s === "♦" ? "/cyankingofclovers.gif" : c.s === "♥" ? "/yellowkingofclovers.gif" : "/kingofclovers.gif"
    };
    const file = rankToFile[c.r];
    if (file) {
      const img = document.createElement("img");
      img.src = file;
      img.alt = `${c.r} of ${c.s === "♠" ? "pink clovers" : c.s === "♦" ? "cyan diamonds" : "clubs"}`;
      div.appendChild(img);
    } else {
      // fallback to Unicode card for other ranks
      div.textContent = cardUnicode(c);
    }
  } else {
    div.textContent = cardUnicode(c);
  }
  container.appendChild(div);
  // add bounce animation to card image only after it finishes loading (or immediately if cached)
  const img = div.querySelector('img');
  if (img) {
    const onLoaded = () => {
      img.removeEventListener('load', onLoaded);
      img.removeEventListener('error', onLoaded);
      // force reflow then add visible class to play CSS bounce-in animation
      void div.offsetWidth;
      div.classList.add('visible');
    };
    img.addEventListener('load', onLoaded);
    img.addEventListener('error', onLoaded);
    if (img.complete && img.naturalWidth !== 0) onLoaded();
  }
}

function startRound() {
  state.deck = makeDeck();
  state.player = [];
  state.dealer = [];
  state.finished = false;
  state.dealerHidden = null;
  el.status.textContent = "";

  // hide any previous result
  hideResult();

  // clear any existing rendered cards so the new round starts fresh
  el.playerCards.innerHTML = "";
  el.dealerCards.innerHTML = "";

  // initial deal
  state.player.push(state.deck.pop());
  state.dealer.push(state.deck.pop());
  state.player.push(state.deck.pop());
  state.dealerHidden = state.deck.pop();
  state.dealer.unshift(state.dealerHidden);

  // natural blackjack checks after reveal only if player stands or immediate
  checkImmediateEnd();
  render();
}

function checkImmediateEnd() {
  const p = handTotal(state.player);
  if (p === 21) {
    // auto-stand
    dealerPlay();
  }
}

function playerHit() {
  if (state.finished) return;
  state.player.push(state.deck.pop());
  const p = handTotal(state.player);
  if (p > 21) {
    // reveal dealer card on bust
    state.finished = true;
    revealDealer();
    // replace text status with gif
    // el.status.textContent = "Bust. You lose.";
    showResult("lose");
    pushRoundResult("lose");
  } else {
    // keep playing
  }
  render();
}

function playerStand() {
  if (state.finished) return;
  dealerPlay();
}

function revealDealer() {
  if (state.dealerHidden) {
    // dealerHidden already in position 0
    state.dealerHidden = null;
  }
}

function dealerPlay() {
  revealDealer();
  // Dealer hits until 17 or more (standard: soft 17 stands)
  while (handTotal(state.dealer) < 17) {
    state.dealer.push(state.deck.pop());
  }
  state.finished = true;
  const p = handTotal(state.player);
  const d = handTotal(state.dealer);
  if (d > 21) {
    // el.status.textContent = "Dealer busts. You win.";
    pushRoundResult("win");
  } else if (p > d) {
    // el.status.textContent = "You win.";
    pushRoundResult("win");
  } else if (p < d) {
    // el.status.textContent = "You lose.";
    pushRoundResult("lose");
  } else {
    // el.status.textContent = "Push.";
    pushRoundResult("push");
  }
  render();
}

// finalize a round when ending from places other than dealerPlay (e.g. player bust)
function pushRoundResult(kind) {
  // ensure dealer card is revealed and round is marked finished
  revealDealer();
  state.finished = true;

  // only increment wins on a real win
  if (kind === "win") {
    state.wins = (state.wins || 0) + 1;
    updateWinsDisplay(); // update the visible counter immediately
  }

  // show appropriate result image and update UI
  if (kind === "win" || kind === "lose" || kind === "push") {
    showResult(kind);
  }
  render();
}

// add show/hide result helpers
function showResult(kind) {
  const map = {
    win: "/win.gif",
    lose: "/lose.gif",
    push: "/push.gif"
  };
  const src = map[kind];
  if (!src) return;
  // clear any previous animation class
  el.resultImg.classList.remove('result-bounce');

  // set src/alt and make visible
  el.resultImg.src = src;
  el.resultImg.alt = "";                 // prevent fallback text from showing
  el.resultImg.style.display = "block";
  el.result.classList.add("visible");
  el.result.setAttribute("aria-hidden", "false");

  // add animation class only after the image finishes loading (or immediately if cached)
  const onLoaded = () => {
    el.resultImg.removeEventListener('load', onLoaded);
    el.resultImg.removeEventListener('error', onLoaded);
    // force reflow then add class so animation plays
    void el.resultImg.offsetWidth;
    el.resultImg.classList.add('result-bounce');
    // remove the class after animationend so it can replay next time
    const onEnd = () => {
      el.resultImg.removeEventListener('animationend', onEnd);
      el.resultImg.classList.remove('result-bounce');
    };
    el.resultImg.addEventListener('animationend', onEnd);
  };

  el.resultImg.addEventListener('load', onLoaded);
  el.resultImg.addEventListener('error', onLoaded);

  // If the image is already cached and complete, trigger handler synchronously
  if (el.resultImg.complete && el.resultImg.naturalWidth !== 0) {
    onLoaded();
  }
}

function hideResult() {
  el.result.classList.remove("visible");
  el.result.setAttribute("aria-hidden", "true");
  // clear src and alt immediately and hide the image to avoid broken-image / alt text
  el.resultImg.src = "";
  el.resultImg.alt = "";
  el.resultImg.style.display = "none";
}

// list of all gif assets to preload
const GIF_FILES = [
  "/back.gif","/twoofclovers.gif","/threeofclovers.gif","/aceofclovers.gif","/fiveofclovers.gif",
  "/kingofclovers.gif","/sevenofclovers.gif","/pinkfiveofclovers.gif","/pinkqueenofclovers.gif",
  "/pinkjesterofclovers.gif","/pinkeightofclovers.gif","/pinktwoofclovers.gif","/pinkaceofclovers.gif",
  "/_next.gif","/stand.gif","/pinkthreeofclovers.gif","/eightofclovers.gif","/cyanjesterofclovers.gif",
  "/pinkfourofclovers.gif","/win.gif","/lose.gif","/fourofclovers.gif","/pinksevenofclovers.gif",
  "/pinkkingofclovers.gif","/pinknineofclovers.gif","/pinksixofclovers.gif","/cyaneightofclovers.gif",
  "/cyankingofclovers.gif","/cyansevenofclovers.gif","/cyannineofclovers.gif","/cyansixofclovers.gif",
  "/cyanqueenofclovers.gif","/cyanfourofclovers.gif","/cyantenofclovers.gif","/cyanaceofclovers.gif",
  "/cyantwoofclovers.gif","/sixofclovers.gif","/nineofclovers.gif","/tenofclovers.gif","/queenofclovers.gif",
  "/push.gif","/jesterofclovers.gif","/hit.gif","/pinktenofclovers.gif","/cyanfiveofclovers.gif",
  "/cyanthreeofclovers.gif","/pinkfourofclovers.gif",
  // digit gifs for wins counter
  "/0.gif","/1.gif","/2.gif","/3.gif","/4.gif","/5.gif","/6.gif","/7.gif","/8.gif","/9.gif"
];

// preload helper that returns a promise when all images are loaded (or errored)
function preloadGifs(files) {
  return new Promise(resolve => {
    let loaded = 0;
    const cache = {};
    files.forEach(src => {
      const img = new Image();
      img.onload = img.onerror = () => {
        loaded++;
        if (loaded === files.length) resolve(cache);
      };
      img.src = src;
      cache[src] = img;
    });
  });
}

// wire up (moved to after preload)
function wireUp() {
  el.hit.addEventListener("click", playerHit);
  el.stand.addEventListener("click", playerStand);
  el.newRound.addEventListener("click", startRound);
}

// start after preloading all gifs so animations show immediately
preloadGifs(GIF_FILES).then(() => {
  // small delay so UI paints before heavy operations
  setTimeout(() => {
    wireUp();
    updateWinsDisplay(); // initialize wins display
    startRound();
    // no wins display to initialize
  }, 80);
});
