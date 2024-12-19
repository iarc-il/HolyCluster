from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.exc import ProgrammingError, OperationalError
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, select


from loguru import logger
from db_classes import GeoCache
import settings
#from run_collector import get_geo_cache_from_db

def get_geo_cache_from_db(callsign: str, debug: bool = False):
  query = select(geo_cache).where(geo_cache.c.callsign == callsign)
  result = conn.execute(query).fetchone()

  return result

debug = True

engine = create_engine(settings.DB_URL, echo=False)
Session = sessionmaker(bind=engine)
session = Session()

with engine.connect() as connection:
    connection.execution_options(isolation_level="AUTOCOMMIT")  # Set isolation level to autocommit
    try:
      callsign = "A1BCD"
      spot = get_geo_cache_from_db(callsign=callsign, debug=debug)
      logger.debug(f"{spot}")

    except (ProgrammingError, OperationalError) as e:
        logger.error(f"Error: {e}")


