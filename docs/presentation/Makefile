INPUT_FILE := presentation.md
OUTPUT_FILE := presentation.html
DEV_INCLUDE := dev-preserve-slide.html
REVEALJS_DIR := reveal.js
REVEALJS_VERSION := 4.6.1
TITLE := Holy Cluster - Friedrichshafen 2026

PANDOC_FLAGS := \
	-t revealjs \
	--standalone \
	--slide-level=2 \
	-V revealjs-url=$(REVEALJS_DIR) \
	-V hash=true \
	--metadata title="$(TITLE)"

.PHONY: all final dev-build dev clean distclean

all: final

final: $(REVEALJS_DIR)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS) --embed-resources

dev-build: $(REVEALJS_DIR) $(DEV_INCLUDE)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS) --include-after-body=$(DEV_INCLUDE)

$(REVEALJS_DIR):
	git clone --depth 1 --branch $(REVEALJS_VERSION) https://github.com/hakimel/reveal.js.git $@

dev: $(REVEALJS_DIR)
	$(MAKE) dev-build
	browser-sync start --server . --index "$(OUTPUT_FILE)" --startPath "$(OUTPUT_FILE)" --files "$(OUTPUT_FILE)" & \
	server_pid=$$!; \
	trap 'kill $$server_pid' EXIT INT TERM; \
	watchexec -w . --filter "$(INPUT_FILE)" --filter "$(DEV_INCLUDE)" -- $(MAKE) dev-build

clean:
	rm -f $(OUTPUT_FILE)

distclean: clean
	rm -rf $(REVEALJS_DIR)
