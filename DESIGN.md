---
name: Сусідня кухня
colors:
  primary: "#972b46"
  ink: "#202437"
  muted: "#596475"
  background: "#f5f7fb"
  surface: "#ffffff"
  border: "#dbe0e8"
typography:
  body:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "16px"
    lineHeight: "1.5"
  display:
    fontFamily: "Georgia, Times New Roman, serif"
omitted:
  - section: spacing
    reason: "Runtime CSS remains the canonical source of spacing."
  - section: rounded
    reason: "Runtime CSS remains the canonical source of radii."
---

# Візуальна система

Каталог і головна сторінка допомагають обрати їжу, керування допомагає обробляти демонстраційні доставки. Збережено наявну бордову палітру, тепле тло в каталозі, фотографії страв і компактну робочу навігацію.

Джерело токенів: `apps/web/src/app/styles.css`; споживачі: `home.css`, `shop.css`, `maps.css` та спільні компоненти `shared/ui`. Токени не генеруються з цього документа. Georgia використовується для виразних заголовків головної сторінки, Segoe UI для форм і робочих екранів.

Канонічні навігація, повідомлення, форми й діалоги описані в [UX-CONTRACT.md](UX-CONTRACT.md). Сторінка акаунта використовує ті самі кольори, поля та повідомлення; окрема роль адміністратора відкриває наявний робочий простір. Pages враховує базовий шлях ресурсів і завжди показує спільне повідомлення про локальну демонстрацію. Воно присутнє з першого рендеру, не зсуває сторінку після завантаження даних і використовує наявні CSS-токени.
