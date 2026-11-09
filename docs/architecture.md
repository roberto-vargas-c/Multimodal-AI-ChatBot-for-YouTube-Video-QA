# Architecture and methodology

## Data flow

1. **Ingestion** (`ingest/`, on a laptop). A YouTube link gives its captions through `youtube-transcript` (or Whisper on its audio when
   there are none); a PDF gives its pages through `pdfjs-dist`. The source's metadata (author, title, language, year, country, building
   type) comes from the command line and YouTube's oEmbed.
2. **Preprocessing** (`src/chunk.ts`). Caption noise (`[Music]`, `>>`, HTML entities) and broken hyphenation are removed. Transcripts
   become windows of about 60 s that overlap by 15 s and never split a caption, so every chunk starts at a real timestamp; book pages
   become chunks of up to 1,200 characters, cut at sentences, never across pages.
3. **Indexing** (`src/store.ts`). The Worker embeds the chunks with `@cf/baai/bge-m3` (multilingual, 1,024 dimensions, so a German
   question finds an English lecture) and stores them in Vectorize with ids `<source>:<n>` and metadata indexed for filtering
   (author, kind, sourceId, typology, country). The source goes into D1.
4. **Asking** (`src/agent.ts`). `createAgent` from LangChain.js with Claude Haiku 5.5, six tools and a system prompt that requires
   searching first and citing every claim by passage id. Memory: the last 12 messages of the session from D1
   (`CloudflareD1MessageHistory`). A model-call limit of 6 per question bounds cost and latency. The response lists only citations whose
   ids the model actually used and that a tool actually returned.
5. **Judging** (`src/jury.ts`). A LangGraph `StateGraph`: the jurors run in parallel, each retrieving from its own author only and
   answering with structured output (zod); invented passage ids are dropped; then the chair merges the verdicts.
6. **Routing** (`src/router.ts`). `/api/chat` sends questions to the agent and requests to judge a design to the jury: keywords first
   (English and German), a one-token model call only when unclear.
7. **Voice** (`src/speech.ts`). The browser records with MediaRecorder; Whisper large-v3-turbo on Workers AI transcribes. Speech
   recognition is only where there is speech: the user's voice, and videos without captions. Books are text and skip it.
8. **Knowledge base** (`src/facts.ts`). `propose_fact` writes a rule for one of Keystone's 50 questions in 12 categories, with the
   passage as evidence. Same answer from another source adds evidence; a different answer marks both as disagreeing. Keystone reads
   `/api/facts` every 5 minutes and merges it over its own files.
9. **Observability and evaluation.** LangSmith traces every agent run, tool call, juror and chair (`runName` and tags per step).
   `eval/run.ts` runs a LangSmith dataset against the live API with five evaluators.

## Choices

| Choice | Why |
|---|---|
| LangChain.js on Workers, not Python | Keystone already runs on Cloudflare; one platform, no extra service, no cold Python container in front of every answer |
| Vectorize + Workers AI embeddings | Same account, no extra key, the LangChain integration exists (`@langchain/cloudflare`) |
| bge-m3 | Multilingual: the library mixes German and English |
| Claude Haiku 5.5 | Fast and cheap enough for a live app with a jury of three; Keystone already uses it |
| No fine-tuning | Retrieval with citations answers from the sources; evaluation compares retrieval settings instead |
| Whisper for videos, not for books | Whisper turns audio into text; a book is already text, so it is read from the PDF's text layer (OCR for scans). Videos with captions use them; Whisper fills in where there are none, and for the user's voice. See the README |
| A daily cap on paid model calls (`AI_PER_DAY`) | Bounds the cost of a public app; checked before work starts, so a crit runs whole or is refused with a message saying when it opens again; raised for a demo day by redeploying with a higher value |
| Timestamp windows with overlap | A citation must point to a real second of the video; overlap keeps sentences on a boundary findable |
| Facts under review until a second source | One lecture should not change how Keystone designs |

## Limits

- YouTube refuses many requests from cloud servers, so ingestion runs on a laptop.
- Whisper on Workers AI takes recordings up to about 20 MB; longer audio is split before ingestion.
- The jury's quality depends on how much of each author is in the library; a juror with nothing to cite says so.
