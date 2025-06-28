const pdfParse = require('pdf-parse');
const fs = require('fs/promises');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { Resend } = require('resend');

async function sendReportViaResend(apiKey, email, filePath) {
 const resend = new Resend(apiKey)
  const fileBuffer = await fs.readFile(filePath);

  const base64Attachment = fileBuffer.toString('base64');

  try {
    const res = await resend.emails.send({
      from: 'DeepThought CARR Reports <noreply@ashubh.dev>',
      to: email,
      subject: 'Your Career Acceleration Readiness Report',
      text: 'Hi,\n\nAttached is your CARR report.\n\n– DeepThought Team',
      attachments: [
        {
          filename: filePath.split('/').pop(),
          content: base64Attachment,
          type: 'application/pdf'
        }
      ]
    });

    console.log('✅ Resend email sent:', res.id);
    return true;
  } catch (err) {
    console.error('❌ Resend failed:', err);
    return false;
  }
}

async function askGemini(promptTemplate, data, apiKey, model = "gemini-2.0-flash") {
    const prompt = promptTemplate.replace("{text}", data);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            return `error: ${response.status} - ${await response.text()}`;
        }

        const json = await response.json();
        const candidates = json.candidates || [];

        if (!candidates.length) return "error: no candidates";

        const parts = candidates[0]?.content?.parts || [];
        if (!parts.length) return "error: no parts";

        return parts[0]?.text?.trim().toLowerCase() || "error: empty response";
    } catch (err) {
        return `error: ${err.message}`;
    }
}

function buildCARRPrompt({ dimension, candidateAnswers, rubricText, carrTemplateText }) {
  const answerSection = Object.entries(candidateAnswers)
    .map(([question, answer], i) => `${i + 1}. ${question}\n"${answer}"`)
    .join("\n\n");

  return `
You are an evaluator preparing a Career Acceleration Readiness Report (CARR) for a candidate.

Dimension: ${dimension}

Below are the candidate’s answers to 4 deep-reflection questions in this dimension:

${answerSection}

Rubric (Level-wise Scoring Criteria for ${dimension}):
${rubricText}

Career Acceleration Readiness Report Template:
${carrTemplateText}

Now write a Career Acceleration Readiness Report for this dimension in a polished, narrative format, suitable to include directly in a PDF feedback document.

Your report should include the following six sections, in numbered order, each written as a paragraph:

1. CSA Score: State the candidate's level (e.g., “L4 – Self-Designer (UBS: Strategist)”) and briefly justify this level using observed behavior.
2. CSA Summary: Describe the candidate’s current level of maturity and behavioral patterns in this dimension using full sentences.
3. RCA (Root Cause Analysis): Identify the emotional, cognitive, or structural blockers that are limiting their evolution to the next level.
4. Growth Nudge: Offer one clear and practical recommendation to help them grow further in this dimension.
5. Role Readiness Mapping: Suggest which UBS-aligned role fits them now, and explain why.
6. Suggested Milestone or Drill: Propose a stretch experience they should attempt, ideally involving real-world application.

Important Formatting Instructions:
- Write this like a formal report — not a chat, summary, or bullet list.
- Do NOT add “Here’s your report” or any extra context.
- Use paragraph structure with numeric section labels as shown above.
- Avoid markdown, bold, bullets, or conversational tone.

Maintain the tone of a reflective, senior evaluator giving clear, constructive insight.

Make sure each of the 6 sections is clearly numbered and follows the style of an executive feedback document.
`.trim();
}

async function getTextFromPDF(path) {
    const pdfBuffer = await fs.readFile(path);
    const parsed = await pdfParse(pdfBuffer);
    return parsed.text;
}

function extractNumberedSections(text) {
  const matches = text.match(/(?=^[1-6]\.\s)/gm);
  if (!matches) return [text];

  const lines = text.split('\n');
  const sections = [];
  let current = '';

  for (const line of lines) {
    if (/^[1-6]\.\s/.test(line.trim())) {
      if (current) sections.push(current.trim());
      current = line.trim();
    } else {
      current += ' ' + line.trim();
    }
  }

  if (current) sections.push(current.trim());
  return sections;
}

async function generateCARRPdf({ email, reports }) {

  await fs.mkdir('./reports', { recursive: true });

  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const titleFontSize = 20;
  const subtitleFontSize = 12;
  const sectionFontSize = 14;
  const bodyFontSize = 11;
  const margin = 50;
  const lineHeight = 16;
  const maxWidth = 90;
  const minY = 40;

  const pageSize = { width: 595.28, height: 841.89 }; // A4 size in points
const width = pageSize.width;
const height = pageSize.height;


  // Cover Page
  const coverPage = pdfDoc.addPage();
  coverPage.drawText('Career Acceleration Readiness Report', {
    x: margin,
    y: height - 80,
    size: titleFontSize,
    font,
    color: rgb(0, 0, 0.7),
  });

  coverPage.drawText(`Candidate Email: ${email}`, {
    x: margin,
    y: height - 110,
    size: subtitleFontSize,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Add each dimension report on a new page
  for (let i = 0; i < reports.length; i++) {
    const { dimension, report } = reports[i];
    let page = pdfDoc.addPage();
    let y = height - 60;

    const paragraphs = extractNumberedSections(report); // breaks the report into 6 sections

    // Add Dimension Title
    page.drawText(`Dimension ${i + 1}: ${dimension}`, {
      x: margin,
      y,
      size: sectionFontSize,
      font,
      color: rgb(0, 0, 0),
    });

    y -= 30;

    for (const para of paragraphs) {
  const match = para.match(/^(\d\.\s+[^\:]+:)(.*)$/);
  const label = match ? match[1].trim() : '';
  const text = match ? match[2].trim() : para;

  const labelWidth = boldFont.widthOfTextAtSize(label, bodyFontSize);
  const labelLines = wrapText(text, maxWidth - labelWidth / 6); // crude adjust
  const firstLine = labelLines.shift();

  if (y < minY + lineHeight * 2) {
    page = pdfDoc.addPage();
    y = height - 50;
  }

  // Draw label (bold)
  page.drawText(label, {
    x: margin,
    y,
    size: bodyFontSize,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  // Draw first line of text right after label
  page.drawText(' ' + firstLine, {
    x: margin + labelWidth + 3,
    y,
    size: bodyFontSize,
    font,
    color: rgb(0, 0, 0)
  });

  y -= lineHeight;

  // Draw remaining lines
  for (const line of labelLines) {
    if (y < minY) {
      page = pdfDoc.addPage();
      y = height - 50;
    }
    page.drawText(line, {
      x: margin,
      y,
      size: bodyFontSize,
      font,
      color: rgb(0, 0, 0),
    });
    y -= lineHeight;
  }

  y -= lineHeight * 0.7; // paragraph spacing
}
  }

  const pdfBytes = await pdfDoc.save();
  const filePath = `./reports/CARR_Report_${email.replace(/[@.]/g, '_')}.pdf`;
  await fs.writeFile(filePath, pdfBytes);
  return filePath;
}

function wrapText(text, maxCharsPerLine = 100) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    console.log(`🗑️ File deleted: ${filePath}`);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠️ File not found: ${filePath}`);
    } else {
      console.error(`❌ Failed to delete file: ${filePath}`, err);
    }
    return false;
  }
}

module.exports = {
    buildCARRPrompt, deleteFile, askGemini, getTextFromPDF, generateCARRPdf, sendReportViaResend
}