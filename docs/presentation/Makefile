INPUT_FILE := presentation.md
OUTPUT_FILE := presentation.html
REVEALJS_DIR := reveal.js
REVEALJS_VERSION := 4.6.1
TITLE := Holy Cluster - Friedrichshafen 2026

PANDOC_FLAGS := \
	-t revealjs \
	--standalone \
	--slide-level=2 \
	-V revealjs-url=$(REVEALJS_DIR) \
	--metadata title="$(TITLE)"

.PHONY: all final dev-build dev clean distclean

all: final

final: $(REVEALJS_DIR)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS) --embed-resources

dev-build: $(REVEALJS_DIR)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS)

$(REVEALJS_DIR):
	git clone --depth 1 --branch $(REVEALJS_VERSION) https://github.com/hakimel/reveal.js.git $@

dev: $(REVEALJS_DIR)
	$(MAKE) dev-build
	browser-sync start --server . --index "$(OUTPUT_FILE)" --startPath "$(OUTPUT_FILE)" --files "$(OUTPUT_FILE)" & \
	server_pid=$$!; \
	trap 'kill $$server_pid' EXIT INT TERM; \
	watchexec -w . --filter "$(INPUT_FILE)" -- $(MAKE) dev-build

clean:
	rm -f $(OUTPUT_FILE)

distclean: clean
	rm -rf $(REVEALJS_DIR)
