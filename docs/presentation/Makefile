INPUT_FILE=presentation.md
OUTPUT_FILE=presentation.html
REVEALJS_DIR=./reveal.js

.PHONY: all show dev watch clean

all: $(OUTPUT_FILE)

$(OUTPUT_FILE): $(INPUT_FILE) $(REVEALJS_DIR)
	pandoc -t revealjs -s -o $(OUTPUT_FILE) $(INPUT_FILE) \
	  --slide-level=2 \
	  -V revealjs-url=$(REVEALJS_DIR) \
	  --embed-resources --standalone \
	  --metadata title="Holy Cluster - Freidrichshafen 2026"

$(REVEALJS_DIR):
	git clone --depth 1 --branch 4.6.1 https://github.com/hakimel/reveal.js.git $@

show: $(OUTPUT_FILE)
	firefox $<

dev:
	# npm install -g browser-sync
	browser-sync start --server . --files $(OUTPUT_FILE)

watch:
	# cargo binstall watchexec-cli
	watchexec -w $(INPUT_FILE) -- pandoc $(INPUT_FILE) -t revealjs -s -o $(OUTPUT_FILE) \
		   --slide-level=2 \
		   -V revealjs-url=$(REVEALJS_DIR)

clean:
	rm -f $(OUTPUT_FILE)
