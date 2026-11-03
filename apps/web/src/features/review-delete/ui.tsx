import type { Review } from "../../entities/review";
import { api } from "../../shared/api";
import { AppForm } from "../../shared/ui";

export function ReviewDelete({
  review,
  onSaved,
}: {
  review: Review;
  onSaved: () => void;
}) {
  return (
    <AppForm
      submitLabel="Видалити відгук"
      cancelLabel="Залишити відгук"
      danger
      onSubmit={() => api.write(`/reviews/${review.id}`, "DELETE", {})}
      onSuccess={onSaved}
    >
      <p>
        Видалити відгук до замовлення № {review.order_id} про{" "}
        {review.restaurant}? Цю дію не можна скасувати.
      </p>
    </AppForm>
  );
}
