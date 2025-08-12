# Use the official Python image.
FROM python:3.13-slim-bookworm

# Install uv for dependency management
RUN pip install uv
# Set the working directory in the container.
WORKDIR /app

# Copy the dependency definitions and lock file.
COPY pyproject.toml uv.lock ./

# Install dependencies using uv.
RUN uv sync --frozen --no-cache

# Copy the source code.
COPY collectors/src ./collectors/src
COPY settings.py ./settings.py
COPY collectors/entrypoint.sh ./collectors/entrypoint.sh

RUN chmod +x collectors/entrypoint.sh

# Set the entrypoint script as the command to run on startup
ENTRYPOINT ["./collectors/entrypoint.sh"]

# Specify the command to run on container startup.
#CMD ["python", "src/run_collector.py"]
CMD ["tail", "-f", "/dev/null"]
