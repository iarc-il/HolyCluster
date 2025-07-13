import json
from test_telnet import parse_dx_line


lines = [
"DX de SP3OCC:     3702.0  SP100IARU    95th PZK - 100th IARU SSB                                                     28 1442Z JO92",
"DX de KC1LAA:    28471.0  CX7RM        USB                                                                           14 1442Z  8",
"DX de DJ5LA:     24891.0  VP2VI        QSX 24892.30  CW                                                            FK78 1442Z JO44",
    ]
    
for line in lines:
  print(line)
  spot = parse_dx_line(line)
  print(json.dumps(spot, indent=2))
  print("\n\n")
  
