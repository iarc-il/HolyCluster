BUILD_DIR := build
INPUT_FILE := presentation.md
OUTPUT_FILE := $(BUILD_DIR)/presentation.html
REVEALJS_DIR := $(BUILD_DIR)/reveal.js
DEV_INCLUDE := dev-preserve-slide.html
REVEALJS_VERSION := 4.6.1
TITLE := Holy Cluster - Friedrichshafen 2026

PANDOC_FLAGS := \
	-t revealjs \
	--standalone \
	--slide-level=2 \
	-V revealjs-url=$(REVEALJS_DIR) \
	-V hash=true \
	-V theme=night \
	-V transition=none \
	-V pagetitle="$(TITLE)"

.PHONY: all final dev-build dev clean distclean

all: final

final: $(REVEALJS_DIR)
	cp -r imgs $(BUILD_DIR)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS) --embed-resources

dev-build: $(REVEALJS_DIR) $(DEV_INCLUDE)
	pandoc $(INPUT_FILE) -o $(OUTPUT_FILE) $(PANDOC_FLAGS) --include-after-body=$(DEV_INCLUDE)

$(REVEALJS_DIR):
	git clone --depth 1 --branch $(REVEALJS_VERSION) https://github.com/hakimel/reveal.js.git $@

dev: $(REVEALJS_DIR)
	$(MAKE) dev-build
	browser-sync start \
		--server . \
		--index "$(OUTPUT_FILE)" \
		--startPath "$(OUTPUT_FILE)" \
		--files "$(OUTPUT_FILE)" \
		--no-open & \
	server_pid=$$!; \
	trap 'kill $$server_pid' EXIT INT TERM; \
	watchexec \
		-w . \
		--filter "$(INPUT_FILE)" \
		--filter "$(DEV_INCLUDE)" \
		--filter $(MAKEFILE_LIST) \
		-- $(MAKE) dev-build

clean:
	rm -f $(OUTPUT_FILE)

distclean:
	rm -rf $(BUILD_DIR)
