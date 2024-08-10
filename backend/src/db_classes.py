from sqlalchemy import Column, Integer, Text, Boolean, Time, Date
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class DxheatRaw(Base):
    __tablename__ = 'dxheat_raw'
    number = Column(Integer, primary_key=True)
    spotter = Column(Text)
    frequency = Column(Text)
    dx_call = Column(Text)
    time = Column(Time)
    date = Column(Date)
    beacon = Column(Boolean)
    mm = Column(Boolean)
    am = Column(Boolean)
    valid = Column(Boolean)
    lotw = Column(Boolean)
    lotw_date = Column(Date)
    esql = Column(Boolean)
    dx_homecall = Column(Text)
    comment = Column(Text)
    flag = Column(Text)
    band = Column(Text)
    mode = Column(Text)  # Added mode column
    continent_dx = Column(Text)
    continent_spotter = Column(Text)
    dx_locator = Column(Text)
