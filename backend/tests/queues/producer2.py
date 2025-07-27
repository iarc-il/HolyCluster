import redis
import time

r = redis.Redis()

def produce(producer_id):
    count = 0
    while True:
        msg = f"Message {count} from producer {producer_id}"
        r.xadd("mystream", {"data": msg})
        print(f"Produced: {msg}")
        count += 1
        time.sleep(1)

if __name__ == "__main__":
    produce(producer_id=2)  # or 2 for the second producer

