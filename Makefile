IMAGE ?= draft-check:latest
PORT  ?= 8080

.PHONY: install dev build lint preview test test-watch docker-build docker-run

install:
	bun install

dev:
	bun run dev

build:
	bun run build

lint:
	bun run lint

preview:
	bun run preview

test:
	bun test

test-watch:
	bun test --watch

docker-build:
	docker build -t $(IMAGE) .

docker-run: docker-build
	docker run --rm -p $(PORT):8080 --name draft-check $(IMAGE)
