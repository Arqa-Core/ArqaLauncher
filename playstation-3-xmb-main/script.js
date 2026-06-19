// Elements
const video = document.getElementById("vid");
const titles = document.getElementById("title");
const warning = document.querySelector(".warning");
const menu = document.getElementById("menu");
const clockSection = document.querySelector(".clock");
const dateTime = document.getElementById("date");
const startupSound = document.getElementById("startup");
const navSound = document.getElementById("nav");

const sections = document.querySelectorAll(".xmb-title");
let sectionNumber = 0;
let subsection = 0;

// Play startup sound
startupSound.play();

// Clock
function updateClock() {
    const d = new Date();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    dateTime.innerText = `${d.getDate()}/${d.getMonth()+1} ${hours}:${minutes}`;
    setTimeout(updateClock, 1000);
}

// Hide menu initially
menu.style.opacity = '0';
clockSection.style.opacity = '0';

// Start sequence: Logo, Warning, Menu
async function startSequence() {
    video.style.opacity = '1';
    titles.style.opacity = '1';

    await new Promise(r => setTimeout(r, 10000)); // 10s logo
    titles.style.opacity = '0';
    setTimeout(() => titles.style.display = 'none', 1000);

    warning.style.display = 'flex';
    warning.style.opacity = '1';
    await new Promise(r => setTimeout(r, 7000)); // 7s warning
    warning.style.opacity = '0';
    setTimeout(() => warning.style.display = 'none', 1000);

    menu.style.opacity = '1';
    clockSection.style.opacity = '1';
    updateClock();
    showSubmenu();
}

// Show active section + submenu
function showSubmenu() {
    sections.forEach((sec, i) => {
        const subs = sec.querySelectorAll(".submenu");
        if (i === sectionNumber) {
            sec.classList.add("active");
            subs.forEach((sm, idx) => {
                sm.classList.toggle("active", idx === subsection);
            });

            // scroll submenu container vertically so the selected entry
            // appears in a fixed spot (top of the list by default)
            if (subs.length) {
                const container = sec.querySelector('.xmb-contents');
                const gap = 8; // matches the CSS gap value
                const itemHeight = subs[0].offsetHeight + gap;
                const offsetY = -subsection * itemHeight;
                container.style.transform = `translateX(-50%) translateY(${offsetY}px)`;
            }
        } else {
            sec.classList.remove("active");
            subs.forEach(sm => sm.classList.remove("active"));
            const container = sec.querySelector('.xmb-contents');
            if (container) container.style.transform = '';
        }
    });

    // Menu verschuiven zodat geselecteerde item in het midden blijft
    const itemWidth = 130; // Gemiddelde breedte per item (img + spacing)
    const offsetX = -sectionNumber * itemWidth;
    menu.style.transform = `translateX(${offsetX}px) translate(-50%, -50%)`;
}

// Keyboard navigation
document.body.addEventListener('keydown', e => {
    const activeSection = sections[sectionNumber];
    const subs = activeSection.querySelectorAll(".submenu");
    const maxSub = subs.length - 1;

    switch(e.key) {
        case 'ArrowRight':
            sectionNumber = Math.min(sectionNumber + 1, sections.length - 1);
            subsection = 0; // reset submenu
            navSound.play();
            showSubmenu();
            break;
        case 'ArrowLeft':
            sectionNumber = Math.max(sectionNumber - 1, 0);
            subsection = 0;
            navSound.play();
            showSubmenu();
            break;
        case 'ArrowDown':
            // move down; wrap to top when at end so scrolling doesn't drift
            if (subsection < maxSub) {
                subsection++;
            } else {
                subsection = 0;
            }
            navSound.play();
            showSubmenu();
            break;
        case 'ArrowUp':
            // move up; wrap to bottom when at start
            if (subsection > 0) {
                subsection--;
            } else {
                subsection = maxSub;
            }
            navSound.play();
            showSubmenu();
            break;
    }
});

// Wait until DOM is fully loaded
document.addEventListener("DOMContentLoaded", startSequence);