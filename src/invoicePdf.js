import { formatMoneyFixed, sumMoney } from './money';

// Invoice totals from the chosen lines: subtotal, VAT (if added) and total, all to the penny.
export const invoiceTotals = (lines, vatOn, vatRate) => {
  const subtotal = sumMoney(lines.map(l => l.total));
  const vat = vatOn ? Math.round(subtotal * vatRate) / 100 : 0;
  return { subtotal, vat, total: sumMoney([subtotal, vat]) };
};

const longDate = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

const safeFileName = (text) => text.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'project';

// Builds the invoice PDF and returns the jsPDF document. The PDF library is loaded only when needed.
export async function buildInvoicePdf({ seller, client, invoice, project, lines, vatOn, vatRate }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const money = (n) => formatMoneyFixed(n, project.currency);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const right = pageWidth - margin;
  const dark = [30, 41, 59];
  const muted = [100, 116, 139];
  const accent = [37, 99, 235];

  // Header: INVOICE on the left, your business on the right.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(...accent);
  doc.text('INVOICE', margin, 28);

  doc.setTextColor(...dark);
  doc.setFontSize(12);
  doc.text(seller.business_name, right, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...muted);
  const sellerLines = [...seller.address.split('\n'), seller.email].map(l => l.trim()).filter(Boolean);
  sellerLines.forEach((line, i) => doc.text(line, right, 28 + i * 4.6, { align: 'right' }));

  // Invoice details and Bill to.
  let y = Math.max(44, 30 + sellerLines.length * 4.6 + 8);
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y - 6, right, y - 6);

  const label = (text, x, yy) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...muted); doc.text(text.toUpperCase(), x, yy); };
  const value = (text, x, yy, opts) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...dark); doc.text(text, x, yy, opts); };

  label('Bill to', margin, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...dark);
  doc.text(client.name, margin, y + 5.5);
  const clientLines = client.details.split('\n').map(l => l.trim()).filter(Boolean);
  clientLines.forEach((line, i) => value(line, margin, y + 10.5 + i * 4.8));

  const detailsX = pageWidth / 2 + 20;
  [['Invoice number', invoice.number], ['Issue date', longDate(invoice.issueDate)], ['Due date', longDate(invoice.dueDate)], ['Project', project.name]]
    .forEach(([l, v], i) => {
      label(l, detailsX, y + i * 9.5);
      value(doc.splitTextToSize(v, right - detailsX)[0], detailsX, y + 4.6 + i * 9.5);
    });

  y = Math.max(y + 12 + clientLines.length * 4.8, y + 4 * 9.5) + 4;

  // Itemised lines.
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Description', 'Qty', 'Unit price', 'Amount']],
    body: lines.map(l => [l.category ? `${l.description}\n${l.category}` : l.description, String(l.quantity), money(l.unit_cost), money(l.total)]),
    styles: { font: 'helvetica', fontSize: 9.5, textColor: dark, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: [241, 245, 249], textColor: dark, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 34 } },
    didParseCell: (data) => { if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right'; }
  });

  // Totals.
  const { subtotal, vat, total } = invoiceTotals(lines, vatOn, vatRate);
  y = doc.lastAutoTable.finalY + 8;
  if (y > 250) { doc.addPage(); y = 24; }
  const totalsLabelX = right - 70;
  const totalRow = (l, v, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 12 : 10);
    doc.setTextColor(...dark);
    doc.text(l, totalsLabelX, y);
    doc.text(v, right, y, { align: 'right' });
    y += bold ? 8 : 6;
  };
  totalRow('Subtotal', money(subtotal));
  if (vatOn) totalRow(`VAT (${vatRate}%)`, money(vat));
  doc.setDrawColor(...dark);
  doc.line(totalsLabelX, y - 3.5, right, y - 3.5);
  y += 2;
  totalRow('Total due', money(total), true);

  // Payment details and notes.
  const block = (title, text) => {
    if (!text.trim()) return;
    const wrapped = doc.splitTextToSize(text.trim(), right - margin);
    if (y + 8 + wrapped.length * 4.8 > 280) { doc.addPage(); y = 24; }
    y += 6;
    label(title, margin, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...dark);
    doc.text(wrapped, margin, y + 5);
    y += 5 + wrapped.length * 4.6;
  };
  block('Payment details', seller.payment_details);
  block('Notes', invoice.notes);

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...muted);
    doc.text(`${seller.business_name} · ${invoice.number}${pages > 1 ? ` · Page ${i} of ${pages}` : ''}`, pageWidth / 2, 290, { align: 'center' });
  }

  return doc;
}

export const invoiceFileName = (invoice, project) => `Invoice-${invoice.number}-${safeFileName(project.name)}.pdf`;
