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

    def __repr__(self):
        return (f"<DxheatRaw(number={self.number}, spotter={self.spotter}, frequency={self.frequency}, "
                    f"dx_call={self.dx_call}, time={self.time}, date={self.date}, beacon={self.beacon}, "
                    f"mm={self.mm}, am={self.am}, valid={self.valid}, lotw={self.lotw}, lotw_date={self.lotw_date}, "
                    f"esql={self.esql}, dx_homecall={self.dx_homecall}, comment={self.comment}, "
                    f"flag={self.flag}, band={self.band}, mode={self.mode}, continent_dx={self.continent_dx}, "
                    f"continent_spotter={self.continent_spotter}, dx_locator={self.dx_locator})>")
