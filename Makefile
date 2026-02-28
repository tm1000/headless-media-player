.PHONY: build start stop nuke

build:
	docker compose build

start: build
	docker compose up -d

stop:
	docker compose down

nuke: stop
	rm -rf videos/* state/* thumbnails/*
	@echo "All media, state, and thumbnails cleared."
