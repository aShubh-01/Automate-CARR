const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const {
  askGemini,
  getTextFromPDF,
  buildCARRPrompt,
  generateCARRPdf,
  sendReportViaResend,
  deleteFile
} = require('./utils');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PORT = process.env.PORT || 3000;

async function generateCarrReports(formPayload, apiKey) {
  const carrTemplateText = await getTextFromPDF('./CARR Docs/Career Acceleration Readiness Report Template.pdf');
  const reports = [];

  for (const entry of formPayload.responsesByDimension) {
    const { dimension, candidateAnswers } = entry;
    console.log('🧠 Generating report for:', dimension);
    try {
      const rubricText = await getTextFromPDF(`./CARR Docs/${dimension}.pdf`);
      const prompt = buildCARRPrompt({
        dimension,
        candidateAnswers,
        rubricText,
        carrTemplateText
      });

      const response = await askGemini("{text}", prompt, apiKey, "gemini-2.0-flash");

      reports.push({ dimension, report: response });
      console.log('✅ Completed:', dimension);
    } catch (err) {
      console.error("❌ Error generating CARR for", dimension, err);
      throw err;
    }
  }

  return {
    email: formPayload.email,
    reports
  };
}

app.post('/generate-carr', async (req, res) => {
  const formPayload = req.body;

  if (!formPayload || !formPayload.email || !formPayload.responsesByDimension) {
    return res.status(400).json({ error: 'Invalid payload. Expecting email and responsesByDimension.' });
  }

  try {
    const result = await generateCarrReports(formPayload, GEMINI_API_KEY);
    const pdfPath = await generateCARRPdf(result);

    console.log(pdfPath);

    const sent = await sendReportViaResend(
      RESEND_API_KEY,
      result.email,
      pdfPath
    );

    await deleteFile(pdfPath);

    if (sent) {
      res.status(200).json({ message: 'CARR report generated and emailed successfully.' });
    } else {
      res.status(500).json({ error: 'Report generated but email failed.' });
    }

  } catch (err) {
    console.error('❌ Failed to process CARR request:', err);
    res.status(500).json({ error: 'Internal server error. Check logs for details.' });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
