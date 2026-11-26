import { formatMoneyFixed, sumMoney } from './money';
import { formatDate, formatDatesIn, DEFAULT_DATE_FORMAT } from './dates';

// Invoice totals from the chosen lines: subtotal, VAT (if added) and total, all to the penny.
export const invoiceTotals = (lines, vatOn, vatRate) => {
  const subtotal = sumMoney(lines.map(l => l.total));
  const vat = vatOn ? Math.round(subtotal * vatRate) / 100 : 0;
  return { subtotal, vat, total: sumMoney([subtotal, vat]) };
};


const safeFileName = (text) => text.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'project';

// Builds the invoice PDF and returns the jsPDF document. The PDF library is loaded only when needed.
// A credit note uses the same layout, with its own title, details, table, total label and blocks (`layout`).
export async function buildInvoicePdf({ seller, client, invoice, project, lines, vatOn, vatRate, totals: savedTotals, dateFormat = DEFAULT_DATE_FORMAT, layout = null }) {
  const longDate = (iso) => formatDate(iso, 'long', dateFormat);
  const describe = (text) => formatDatesIn(text, dateFormat);
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
  doc.text(layout?.title || 'INVOICE', margin, 28);

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

  label(layout?.clientLabel || 'Bill to', margin, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...dark);
  doc.text(client.name, margin, y + 5.5);
  const clientLines = client.details.split('\n').map(l => l.trim()).filter(Boolean);
  clientLines.forEach((line, i) => value(line, margin, y + 10.5 + i * 4.8));

  const detailsX = pageWidth / 2 + 20;
  const detailRows = layout?.details?.(longDate) ||
    [['Invoice number', invoice.number], ['Issue date', longDate(invoice.issueDate)], ['Due date', longDate(invoice.dueDate)], ['Project', project.name]];
  detailRows
    .forEach(([l, v], i) => {
      label(l, detailsX, y + i * 9.5);
      value(doc.splitTextToSize(v, right - detailsX)[0], detailsX, y + 4.6 + i * 9.5);
    });

  y = Math.max(y + 12 + clientLines.length * 4.8, y + detailRows.length * 9.5) + 4;

  // Itemised lines.
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: layout ? [['Description', 'Amount credited']] : [['Description', 'Qty', 'Unit price', 'Amount']],
    body: lines.map(l => {
      const text = l.category ? `${describe(l.description)}\n${l.category}` : describe(l.description);
      return layout ? [text, money(l.total)] : [text, String(l.quantity), money(l.unit_cost), money(l.total)];
    }),
    styles: { font: 'helvetica', fontSize: 9.5, textColor: dark, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: [241, 245, 249], textColor: dark, fontStyle: 'bold' },
    columnStyles: layout ? { 1: { halign: 'right', cellWidth: 40 } } : { 1: { halign: 'right', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 34 } },
    didParseCell: (data) => { if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right'; }
  });

  // Totals.
  const { subtotal, vat, total } = savedTotals || invoiceTotals(lines, vatOn, vatRate);
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
  totalRow(layout?.totalLabel || 'Total due', money(total), true);

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
  (layout?.blocks || [['Payment details', seller.payment_details], ['Notes', invoice.notes]]).forEach(([t, text]) => block(t, text || ''));

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

// Loads the PDF library ahead of time, so issuing an invoice doesn't fail half-way on a slow connection.
export const preloadPdfLibrary = () => Promise.all([import('jspdf'), import('jspdf-autotable')]);

// Downloads an issued invoice exactly as it was recorded (seller, client, lines and totals are copies).
export async function downloadIssuedInvoice(invoice, invoiceItems, projectName, dateFormat = DEFAULT_DATE_FORMAT) {
  const lines = invoiceItems
    .filter(l => l.invoice_id === invoice.id)
    .sort((a, b) => a.position - b.position)
    .map(l => ({ description: l.description, category: l.category, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), total: Number(l.total) }));
  const vatOn = invoice.vat_rate !== null && invoice.vat_rate !== undefined;
  const details = { number: invoice.number, issueDate: invoice.issue_date, dueDate: invoice.due_date || '', notes: invoice.notes || '' };
  const project = { name: projectName, currency: invoice.currency };
  const doc = await buildInvoicePdf({
    seller: { business_name: invoice.seller_name, address: invoice.seller_address || '', email: invoice.seller_email || '', payment_details: invoice.seller_payment_details || '' },
    client: { name: invoice.client_name, details: invoice.client_address || '' },
    invoice: details,
    project,
    lines,
    vatOn,
    vatRate: vatOn ? Number(invoice.vat_rate) : 0,
    totals: { subtotal: Number(invoice.subtotal), vat: Number(invoice.vat), total: Number(invoice.total) },
    dateFormat
  });
  doc.save(invoiceFileName(details, project));
}

// Downloads an issued credit note, using its invoice's saved copy of the seller and client.
export async function downloadCreditNote(creditNote, invoice, creditNoteItems, projectName, dateFormat = DEFAULT_DATE_FORMAT) {
  const lines = creditNoteItems
    .filter(l => l.credit_note_id === creditNote.id)
    .sort((a, b) => a.position - b.position)
    .map(l => ({ description: l.description, category: l.category, total: Number(l.amount) }));
  const vatOn = creditNote.vat_rate !== null && creditNote.vat_rate !== undefined;
  const project = { name: projectName, currency: creditNote.currency };
  const doc = await buildInvoicePdf({
    seller: { business_name: invoice.seller_name, address: invoice.seller_address || '', email: invoice.seller_email || '', payment_details: '' },
    client: { name: invoice.client_name, details: invoice.client_address || '' },
    invoice: { number: creditNote.number },
    project,
    lines,
    vatOn,
    vatRate: vatOn ? Number(creditNote.vat_rate) : 0,
    totals: { subtotal: Number(creditNote.subtotal), vat: Number(creditNote.vat), total: Number(creditNote.total) },
    dateFormat,
    layout: {
      title: 'CREDIT NOTE',
      clientLabel: 'Client',
      details: (longDate) => [['Credit note number', creditNote.number], ['Issue date', longDate(creditNote.issue_date)],
        ['Against invoice', `${invoice.number} of ${longDate(invoice.issue_date)}`], ['Project', projectName]],
      totalLabel: 'Total credited',
      blocks: [['Reason', creditNote.reason]]
    }
  });
  doc.save(`Credit-note-${creditNote.number}-${safeFileName(projectName)}.pdf`);
}
