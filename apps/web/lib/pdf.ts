import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { pdfSafe, saStamp } from './pdf-text';
import type { PdfBrand } from './pdf-brand';

/** '#ef4444' → pdf-lib colour. */
function hex(tone: string) {
  const n = Number.parseInt(tone.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Text on a colour: dark on the light hues (yellow), white on the rest. */
function ink(tone: string) {
  const n = Number.parseInt(tone.replace('#', ''), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 165 ? rgb(0.07, 0.09, 0.15) : rgb(1, 1, 1);
}

/**
 * Minimal report-PDF builder shared by the case-report and fire-report
 * endpoints (replaces V4's PdfSharp generators).
 */
export class ReportPdf {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private font!: PDFFont;
  private bold!: PDFFont;
  private y = 0;
  private readonly margin = 50;
  /** The municipality's name, signed on every page's footer. */
  private brandName: string | null = null;

  /**
   * `brand`: the municipality served (eThekwini), on the right of the header
   * band and in every footer. HikTech's own line on the left is unchanged.
   */
  static async create(title: string, subtitle: string, brand?: PdfBrand | null) {
    const r = new ReportPdf();
    r.doc = await PDFDocument.create();
    r.font = await r.doc.embedFont(StandardFonts.Helvetica);
    r.bold = await r.doc.embedFont(StandardFonts.HelveticaBold);
    r.newPage();
    // Header band
    r.page.drawRectangle({
      x: 0, y: r.page.getHeight() - 70, width: r.page.getWidth(), height: 70,
      color: rgb(0.07, 0.09, 0.15),
    });
    r.page.drawText('HIKTECH - eThekwini Emergency Services', {
      x: r.margin, y: r.page.getHeight() - 32, size: 10, font: r.bold, color: rgb(0.89, 0.12, 0.17),
    });
    r.page.drawText(pdfSafe(title), {
      x: r.margin, y: r.page.getHeight() - 52, size: 16, font: r.bold, color: rgb(1, 1, 1),
    });
    if (brand) await r.letterhead(brand);
    r.y = r.page.getHeight() - 95;
    r.text(subtitle, 9, rgb(0.4, 0.4, 0.4));
    r.y -= 8;
    return r;
  }

  /** The municipality's crest (on a white tile, so a coloured crest reads on the dark band) and name. */
  private async letterhead(brand: PdfBrand) {
    this.brandName = pdfSafe(brand.name);
    const top = this.page.getHeight();
    const right = this.page.getWidth() - this.margin;
    let textRight = right;
    if (brand.logo) {
      try {
        const img = brand.logo.type === 'png' ? await this.doc.embedPng(brand.logo.bytes) : await this.doc.embedJpg(brand.logo.bytes);
        const box = 52;
        const scale = Math.min((box - 8) / img.width, (box - 8) / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = right - box;
        const y = top - 61;
        this.page.drawRectangle({ x, y, width: box, height: box, color: rgb(1, 1, 1) });
        this.page.drawImage(img, { x: x + (box - w) / 2, y: y + (box - h) / 2, width: w, height: h });
        textRight = x - 10;
      } catch {
        // A crest that will not embed leaves the name on its own.
      }
    }
    const size = 8;
    const width = this.bold.widthOfTextAtSize(this.brandName, size);
    this.page.drawText(this.brandName, { x: textRight - width, y: top - 32, size, font: this.bold, color: rgb(0.85, 0.87, 0.92) });
    const sub = 'Municipal record';
    this.page.drawText(sub, {
      x: textRight - this.font.widthOfTextAtSize(sub, 7), y: top - 43, size: 7, font: this.font, color: rgb(0.6, 0.64, 0.72),
    });
  }

  private newPage() {
    this.page = this.doc.addPage([595, 842]); // A4
    this.y = this.page.getHeight() - 50;
  }

  private ensure(space: number) {
    if (this.y - space < 50) this.newPage();
  }

  section(title: string) {
    this.ensure(30);
    this.y -= 14;
    this.page.drawText(pdfSafe(title).toUpperCase(), {
      x: this.margin, y: this.y, size: 10, font: this.bold, color: rgb(0.15, 0.35, 0.6),
    });
    this.y -= 6;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.page.getWidth() - this.margin, y: this.y },
      thickness: 0.5, color: rgb(0.8, 0.85, 0.9),
    });
    this.y -= 14;
  }

  /** A heading inside a section, with a small square in the form's colour. */
  subheading(title: string, tone?: string) {
    this.ensure(24);
    this.y -= 4;
    const color = tone ? hex(tone) : rgb(0.25, 0.25, 0.25);
    if (tone) this.page.drawRectangle({ x: this.margin, y: this.y - 1, width: 7, height: 7, color });
    this.page.drawText(pdfSafe(title), { x: this.margin + (tone ? 12 : 0), y: this.y, size: 9, font: this.bold, color });
    this.y -= 14;
  }

  /** A row of coloured labels (the forms a report carries), wrapping to the next line. */
  badges(items: Array<{ text: string; tone: string }>) {
    if (!items.length) return;
    const size = 8;
    const padX = 6;
    const h = 15;
    let x = this.margin;
    this.ensure(h + 6);
    for (const item of items) {
      const text = pdfSafe(item.text);
      const w = this.bold.widthOfTextAtSize(text, size) + padX * 2;
      if (x + w > this.page.getWidth() - this.margin) {
        x = this.margin;
        this.y -= h + 4;
        this.ensure(h + 6);
      }
      this.page.drawRectangle({ x, y: this.y - 4, width: w, height: h, color: hex(item.tone) });
      this.page.drawText(text, { x: x + padX, y: this.y, size, font: this.bold, color: ink(item.tone) });
      x += w + 5;
    }
    this.y -= h + 6;
  }

  field(label: string, value: string | number | null | undefined) {
    if (value === null || value === undefined || value === '') return;
    const text = String(value);
    this.ensure(16);
    this.page.drawText(`${pdfSafe(label)}:`, { x: this.margin, y: this.y, size: 9, font: this.bold, color: rgb(0.25, 0.25, 0.25) });
    this.wrap(text, this.margin + 150, 9);
  }

  text(value: string, size = 9, color = rgb(0.1, 0.1, 0.1)) {
    this.wrap(value, this.margin, size, color);
  }

  paragraph(label: string, value: string | null | undefined) {
    if (!value) return;
    this.ensure(28);
    this.page.drawText(pdfSafe(label), { x: this.margin, y: this.y, size: 9, font: this.bold, color: rgb(0.25, 0.25, 0.25) });
    this.y -= 13;
    // Keep the writer's paragraphs: a narrative is read, not scanned.
    for (const para of pdfSafe(value).split(/\n+/)) this.wrap(para, this.margin, 9);
    this.y -= 4;
  }

  private wrap(text: string, x: number, size: number, color = rgb(0.1, 0.1, 0.1)) {
    const maxWidth = this.page.getWidth() - this.margin - x;
    // Every string drawn passes through pdfSafe: one character the font
    // cannot encode would otherwise fail the whole document.
    const words = pdfSafe(text).split(/\s+/).flatMap((w) => this.breakWord(w, size, maxWidth));
    let line = '';
    const flush = () => {
      if (!line) return;
      this.ensure(13);
      this.page.drawText(line, { x, y: this.y, size, font: this.font, color });
      this.y -= 13;
      line = '';
    };
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.font.widthOfTextAtSize(candidate, size) > maxWidth) {
        flush();
        line = word;
      } else {
        line = candidate;
      }
    }
    flush();
  }

  /** A word wider than the line (a URL, a plate run together) broken to fit, instead of running off the page. */
  private breakWord(word: string, size: number, maxWidth: number): string[] {
    if (this.font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
    const parts: string[] = [];
    let part = '';
    for (const ch of word) {
      if (part && this.font.widthOfTextAtSize(part + ch, size) > maxWidth) {
        parts.push(part);
        part = '';
      }
      part += ch;
    }
    if (part) parts.push(part);
    return parts;
  }

  /** Embed a JPEG/PNG image (evidence photos in case reports). */
  async image(bytes: Uint8Array, contentType: string, caption?: string) {
    try {
      const img = contentType.includes('png')
        ? await this.doc.embedPng(bytes)
        : await this.doc.embedJpg(bytes);
      const maxW = this.page.getWidth() - this.margin * 2;
      const scale = Math.min(1, maxW / img.width, 260 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      this.ensure(h + 24);
      this.y -= h;
      this.page.drawImage(img, { x: this.margin, y: this.y, width: w, height: h });
      this.y -= 6;
      if (caption) {
        this.wrap(caption, this.margin, 8, rgb(0.4, 0.4, 0.4));
      }
      this.y -= 8;
    } catch {
      this.text(`(image could not be embedded${caption ? `: ${caption}` : ''})`, 8, rgb(0.6, 0.3, 0.3));
    }
  }

  async bytes() {
    // Footer page numbers
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      p.drawText(`Page ${i + 1} of ${pages.length} · Generated ${saStamp()} SAST`, {
        x: 50, y: 28, size: 7, font: this.font, color: rgb(0.5, 0.5, 0.5),
      });
      if (this.brandName) {
        const w = this.font.widthOfTextAtSize(this.brandName, 7);
        p.drawText(this.brandName, { x: p.getWidth() - this.margin - w, y: 28, size: 7, font: this.font, color: rgb(0.5, 0.5, 0.5) });
      }
    });
    return this.doc.save();
  }
}
