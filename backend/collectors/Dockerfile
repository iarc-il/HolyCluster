# Use the official Python image.
FROM python:3.13-slim-bookworm

# Install uv for dependency management
RUN pip install uv

# Set the working directory in the container.
WORKDIR /app

# Copy the dependency definitions and lock file.
COPY pyproject.toml uv.lock ./

# Install dependencies using uv.
RUN uv sync

# Copy the source code.
COPY src/ ./src/

# Specify the command to run on container startup.
#CMD ["python", "src/run_collector.py"]
CMD ["tail", "-f", "/dev/null"]
