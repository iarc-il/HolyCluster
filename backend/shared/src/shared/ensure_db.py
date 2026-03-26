import asyncio

from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from shared.settings import PostgresSettings


async def ensure_database_exists():
    settings = PostgresSettings()
    engine = create_async_engine(settings.general_db_url + "/postgres")

    async with engine.connect() as conn:
        result = await conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"),
            {"name": settings.postgres_db_name},
        )
        exists = result.scalar() is not None

    if not exists:
        logger.info(f"Database '{settings.postgres_db_name}' does not exist. Creating it.")
        async with engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            await conn.execute(text(f'CREATE DATABASE "{settings.postgres_db_name}"'))
        logger.info(f"Database '{settings.postgres_db_name}' created.")
    else:
        logger.info(f"Database '{settings.postgres_db_name}' already exists.")

    await engine.dispose()


def main():
    asyncio.run(ensure_database_exists())


if __name__ == "__main__":
    main()
