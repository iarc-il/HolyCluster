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

.PHONY: all final dev-build dev watch serve show clean distclean

all: final

final: $(REVEALJS_DIR)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS) --embed-resources

dev-build: $(REVEALJS_DIR)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS)

$(REVEALJS_DIR):
	git clone --depth 1 --branch $(REVEALJS_VERSION) https://github.com/hakimel/reveal.js.git $@

show: final
	firefox $(OUTPUT_FILE)

serve:
	browser-sync start --server . --files $(OUTPUT_FILE)

watch: $(REVEALJS_DIR)
	watchexec -w $(INPUT_FILE) -- $(MAKE) dev-build

dev: $(REVEALJS_DIR)
	$(MAKE) dev-build
	browser-sync start --server . --files "$(OUTPUT_FILE)" & \
	server_pid=$$!; \
	trap 'kill $$server_pid' EXIT INT TERM; \
	watchexec -w "$(INPUT_FILE)" -- $(MAKE) dev-build

clean:
	rm -f $(OUTPUT_FILE)

distclean: clean
	rm -rf $(REVEALJS_DIR)
