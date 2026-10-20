# MGL AI portable install

This path is for developer/home testing and Linux servers. It does not replace the employee Windows installer.

## Laptop / workstation

Requirements: Node.js 22+ and at least ~8 GB free disk for the runtime/model download.

From the repository:

    cd ai
    npm install
    npm run ai:install:portable
    npm run ai:start:portable
    npm run ai:chat -- "Сайн уу, өөрийгөө танилцуул"

Interactive chat:

    npm run ai:chat

Status / stop:

    npm run ai:status:portable
    npm run ai:stop:portable

The portable installer currently pins:

- Qwen3-8B Q4_K_M, SHA-256 120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4
- llama.cpp b11382, with per-platform GitHub release SHA-256 verification
- macOS arm64/x64, Linux x64/arm64, Windows x64/arm64

On Apple Silicon the official macOS llama.cpp build uses Metal. Linux/Windows portable mode chooses the CPU build for maximum compatibility. The existing company Windows installer remains the path for managed CUDA deployment.

Useful flags:

    npm run ai:install:portable -- --skip-model
    npm run ai:install:portable -- --skip-engine
    npm run ai:install:portable -- --force

The 5 GB model download is resumable through the .part file and is checksum-verified before activation.

## Linux server / Docker

From the repository root:

    docker compose -f ai/docker-compose.portable.yml up -d --build

The first boot downloads the pinned model into the persistent mgl-ai-data volume.

The runtime stays bound to 127.0.0.1 on purpose. Do not publish llama-server or the MGL AI runtime directly to the public internet.

To reach a remote server safely from your laptop:

    ssh -L 39217:127.0.0.1:39217 user@your-server

Or run the CLI directly on the server:

    docker compose -f ai/docker-compose.portable.yml exec mgl-ai node scripts/chat.mjs "Туршилтын асуулт"

## What this tests

ai:chat calls the local /generate inference endpoint directly. That is useful for model/fine-tune evaluation.

It deliberately does not pretend to be the full ERP conversation path: company tools, permission-filtered ERP context, and the Worker orchestration/RAG layer are not injected by this CLI. For production-parity tests, use the existing evaluation suites after pairing the runtime with ERP.


## Fine-tuned / LoRA candidate

The existing runtime already supports a developer LoRA override. After exporting a candidate adapter to GGUF, test it with the same portable runtime without publishing it to employees:

macOS / Linux:

    MGLAI_LORA_PATH=/absolute/path/to/candidate.gguf npm run ai:restart:portable
    npm run ai:chat

Windows PowerShell:

    $env:MGLAI_LORA_PATH='C:\absolute\path\to\candidate.gguf'
    npm run ai:restart:portable
    npm run ai:chat

`/info` marks this as a dev candidate; it is not silently promoted to a production release.
